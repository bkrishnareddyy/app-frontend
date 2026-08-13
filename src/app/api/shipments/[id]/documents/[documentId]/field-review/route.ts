import { NextResponse, after } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { EntityResolutionService } from "@/modules/entity/entityResolutionService";
import { ShipmentPartyService, type ShipmentPartyRole } from "@/modules/shipment/shipmentPartyService";
import { ExceptionService, DOCUMENT_FIELD_LABELS } from "@/modules/exceptions/exception.service";
import { FactAuditService } from "@/modules/audit/factAuditService";
import { FactService } from "@/modules/shipment/factService";
import { runReconciliationEngine, type DocumentGroup } from "@/lib/reconciliation/reconciliationEngine";
import { computeReadinessBreakdown } from "@/lib/shipmentReadiness";
import { recomputeShipmentDeadlines } from "@/modules/deadlines/deadline.service";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1), documentId: z.string().min(1) });

const bodySchema = z.object({
  fieldKey: z.enum(["exporterName", "importerName", "originCountry"]),
  action: z.enum(["APPROVE", "EDIT"]),
  value: z.string().trim().min(1, "A value is required"),
});

export const POST = withAuthenticatedRoute<{ id: string; documentId: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id: shipmentId, documentId } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { fieldKey, action, value } = bodyVal.data;

  try {
    const [shipment, document] = await Promise.all([
      db.shipment.findFirst({
        where: { id: shipmentId, accountId: ctx.accountId },
      }),
      db.shipmentDocument.findFirst({ where: { id: documentId, accountId: ctx.accountId } }),
    ]);

    if (!shipment) return buildErrorResponse(404, "NOT_FOUND", "Shipment not found", undefined, requestId);
    if (!document) return buildErrorResponse(404, "NOT_FOUND", "Document not found", undefined, requestId);

    const resolverName = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email;

    // Approving/editing a field review is a user action on the curated
    // record -- versioned and audited the same way any other manual edit
    // is, whichever field it targets.
    if (fieldKey === "originCountry") {
      await FactAuditService.logChangeEvent({
        shipmentId,
        userId: ctx.userId,
        changeType: "USER_FIELD_UPDATE",
        field: "countryOfOrigin",
        previousValue: shipment.countryOfOrigin,
        newValue: value,
        reason: action === "EDIT" ? "Corrected via field review" : "Approved via field review",
      });
      await db.shipment.update({ where: { id: shipmentId }, data: { countryOfOrigin: value, version: { increment: 1 } } });
      await FactService.record({ shipmentId, field: "countryOfOrigin", value, sourceType: "USER_ENTERED", documentId });
    } else {
      const role: ShipmentPartyRole = fieldKey === "importerName" ? "IMPORTER_OF_RECORD" : "EXPORTER";
      const previousParty = await db.shipmentParty.findFirst({
        where: { shipmentId, role },
        include: { legalEntity: { select: { legalName: true } } },
      });

      const resolvedEntity = await EntityResolutionService.findOrCreateEntity(ctx.accountId, value);
      if (!resolvedEntity) {
        return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", "Could not resolve a legal entity for that name", undefined, requestId);
      }
      await ShipmentPartyService.assignParty({
        shipmentId,
        legalEntityId: resolvedEntity.id,
        role,
        source: "USER",
        confidence: 1.0,
        isVerified: true,
      });

      await FactAuditService.logChangeEvent({
        shipmentId,
        userId: ctx.userId,
        changeType: "PARTY_ASSIGNED",
        field: fieldKey,
        previousValue: previousParty?.legalEntity.legalName ?? null,
        newValue: value,
        reason: action === "EDIT" ? "Corrected via field review" : "Approved via field review",
      });
      await db.shipment.update({ where: { id: shipmentId }, data: { version: { increment: 1 } } });
      await FactService.record({ shipmentId, field: fieldKey, value, sourceType: "USER_ENTERED", documentId });
    }

    await db.fieldApproval.create({
      data: {
        accountId: ctx.accountId,
        shipmentId,
        documentId,
        fieldKey,
        value,
        approvedByUserId: ctx.userId,
        approvedByName: resolverName,
      },
    });

    const label = DOCUMENT_FIELD_LABELS[fieldKey];
    await ExceptionService.resolveDocumentFieldException(
      documentId,
      fieldKey,
      { userId: ctx.userId, name: resolverName },
      action === "EDIT" ? `${label} corrected via field review to "${value}".` : `${label} approved as extracted: "${value}".`
    );

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: action === "EDIT" ? "field_review.edit" : "field_review.approve",
      entity: "ShipmentDocument",
      entityId: documentId,
      metadata: { shipmentId, fieldKey, value },
    });

    // F-3: Field correction triggers reconciliation + readiness only — no OCR re-run.
    after(async () => {
      try {
        const fullShipment = await db.shipment.findFirst({
          where: { id: shipmentId },
          include: {
            documents: { include: { extractionFields: true } },
            lineItems: true,
            exceptionItems: { where: { status: { not: "Resolved" } } },
          },
        });
        if (!fullShipment) return;

        const documentGroups: DocumentGroup[] = fullShipment.documents
          .filter((d) => d.extractionFields.length > 0)
          .map((d) => ({
            documentId: d.id,
            docType: d.docType,
            fields: d.extractionFields.map((f) => ({ fieldName: f.fieldName, value: f.value, confidence: f.confidence })),
          }));

        const { results, evaluatedRuleIds } = runReconciliationEngine(documentGroups);
        const severityMap: Record<string, string> = { BLOCKING: "Critical", WARNING: "Warning", INFO: "Info" };
        const openIssues = await db.reconciliationIssue.findMany({ where: { shipmentId, accountId: ctx.accountId, status: "Open" } });
        const evaluatedFields = new Set(evaluatedRuleIds);

        for (const result of results) {
          const existing = openIssues.find((i) => i.field === result.ruleId);
          const data = {
            field: result.ruleId,
            severity: severityMap[result.severity] ?? "Warning",
            expectedValue: `${result.valueA} (${result.docTypeA})`,
            actualValue: `${result.valueB} (${result.docTypeB})`,
            sourceDocuments: [result.docTypeA, result.docTypeB],
          };
          if (existing) {
            await db.reconciliationIssue.update({ where: { id: existing.id }, data });
          } else {
            await db.reconciliationIssue.create({ data: { ...data, shipmentId, accountId: ctx.accountId, status: "Open" } });
          }
        }

        const resolvedRuleIds = new Set(results.map((r) => r.ruleId));
        const staleIds = openIssues
          .filter((i) => evaluatedFields.has(i.field) && !resolvedRuleIds.has(i.field))
          .map((i) => i.id);
        if (staleIds.length > 0) {
          await db.reconciliationIssue.updateMany({ where: { id: { in: staleIds } }, data: { status: "Resolved", resolvedAt: new Date() } });
        }

        const remaining = await db.reconciliationIssue.findMany({ where: { shipmentId, accountId: ctx.accountId, status: "Open" } });
        const blockingCount = remaining.filter((i) => i.severity === "Critical").length;

        const allFields = fullShipment.documents.flatMap((d) => d.extractionFields);
        const avgConf =
          allFields.length === 0 ? undefined : allFields.reduce((s, f) => s + (f.confidence ?? 0), 0) / allFields.length;

        const { totalScore } = computeReadinessBreakdown({
          documents: fullShipment.documents.map((d) => ({ docType: d.docType ?? "", status: d.status ?? "" })),
          lineItems: fullShipment.lineItems.map((li) => ({
            htsCode: li.htsCode ?? "",
            countryOfOrigin: li.countryOfOrigin ?? "",
            quantity: Number(li.quantity),
            unitPrice: li.unitPrice,
            status: li.status,
          })),
          exceptionItems: fullShipment.exceptionItems.map((e) => ({
            status: e.status ?? "Open",
            severity: e.severity ?? "Medium",
            blocking: e.severity === "Critical" || e.severity === "High",
          })),
          avgExtractionConfidence: avgConf,
          blockingReconciliationIssues: blockingCount,
        });

        const healthStatus = totalScore >= 80 ? "Healthy" : totalScore >= 50 ? "At Risk" : "Critical";
        await db.shipment.update({ where: { id: shipmentId }, data: { readinessScore: totalScore, healthStatus } });
        await recomputeShipmentDeadlines(shipmentId);
      } catch {
        // Non-fatal: reconciliation runs on next explicit trigger.
      }
    });

    return NextResponse.json({ success: true, requestId });
  } catch (error: unknown) {
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to save field review", undefined, requestId);
  }

}, { permission: "shipments.manage", write: true });
