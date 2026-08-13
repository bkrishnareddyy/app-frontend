import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { runReconciliationEngine, type DocumentGroup } from "@/lib/reconciliation/reconciliationEngine";
import { computeReadinessBreakdown } from "@/lib/shipmentReadiness";
import { getMissingDocuments } from "@/lib/requiredDocumentTypes";
import { recomputeShipmentDeadlines } from "@/modules/deadlines/deadline.service";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const shipment = await db.shipment.findFirst({
    where: { id, accountId: ctx.accountId, deletedAt: null },
    include: {
      documents: {
        where: { shipmentId: id },
        include: { extractionFields: true },
      },
      lineItems: { orderBy: { lineNumber: "asc" } },
      exceptionItems: { where: { status: { not: "Resolved" } } },
    },
});

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" });
  }

  // Build DocumentGroup[] from extracted fields stored by the extraction pipeline.
  const documentGroups: DocumentGroup[] = shipment.documents
    .filter((d) => d.extractionFields.length > 0)
    .map((d) => ({
      documentId: d.id,
      docType: d.docType,
      fields: d.extractionFields.map((f) => ({
        fieldName: f.fieldName,
        value: f.value,
        confidence: f.confidence,
      })),
    }));

  const { results, evaluatedRuleIds } = runReconciliationEngine(documentGroups);

  // Persist discrepancies to ReconciliationIssue rows.
  // Map engine severity → existing DB severity vocabulary.
  const severityMap: Record<string, string> = {
    BLOCKING: "Critical",
    WARNING: "Warning",
    INFO: "Info",
  };

  const openIssues = await db.reconciliationIssue.findMany({
    where: { shipmentId: id, accountId: ctx.accountId, status: "Open" },
  });

  const evaluatedFields = new Set(evaluatedRuleIds);

  // Upsert: update if an issue for this rule already exists, else create.
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
      await db.reconciliationIssue.create({
        data: { ...data, shipmentId: id, accountId: ctx.accountId, status: "Open" },
      });
    }
  }

  // Auto-resolve issues for rules that ran cleanly this time.
  const resolvedRuleIds = new Set(results.map((r) => r.ruleId));
  const staleIds = openIssues
    .filter((i) => evaluatedFields.has(i.field) && !resolvedRuleIds.has(i.field))
    .map((i) => i.id);

  if (staleIds.length > 0) {
    await db.reconciliationIssue.updateMany({
      where: { id: { in: staleIds } },
      data: { status: "Resolved", resolvedAt: new Date() },
    });
  }

  const remainingOpen = await db.reconciliationIssue.findMany({
    where: { shipmentId: id, accountId: ctx.accountId, status: "Open" },
    orderBy: { createdAt: "asc" },
  });

  const blockingCount = remainingOpen.filter((i) => i.severity === "Critical").length;

  // Compute and persist readiness score + healthStatus now that reconciliation is fresh.
  const allFields = shipment.documents.flatMap((d) => d.extractionFields);
  const avgExtractionConfidence =
    allFields.length === 0
      ? undefined
      : allFields.reduce((s, f) => s + (f.confidence ?? 0), 0) / allFields.length;

  const { totalScore } = computeReadinessBreakdown({
    documents: shipment.documents.map((d) => ({ docType: d.docType ?? "", status: d.status ?? "" })),
    lineItems: shipment.lineItems.map((li) => ({
      htsCode: li.htsCode ?? "",
      countryOfOrigin: li.countryOfOrigin ?? "",
      quantity: Number(li.quantity),
      unitPrice: li.unitPrice,
      status: li.status,
    })),
    exceptionItems: shipment.exceptionItems.map((e) => ({
      status: e.status ?? "Open",
      severity: e.severity ?? "Medium",
      blocking: e.severity === "Critical" || e.severity === "High",
    })),
    avgExtractionConfidence,
    blockingReconciliationIssues: blockingCount,
  });

  const healthStatus =
    totalScore >= 80 ? "Healthy" : totalScore >= 50 ? "At Risk" : "Critical";

  await db.shipment.update({
    where: { id },
    data: { readinessScore: totalScore, healthStatus },
  });

  // E-4: Recompute compliance deadlines (updates Shipment.filingDeadline cache).
  await recomputeShipmentDeadlines(id);

  // D-3: Auto-create/resolve ExceptionItem rows for missing required documents.
  const missingDocs = getMissingDocuments(
    shipment.documents.map((d) => ({
      docType: d.docType ?? null,
      fileName: d.fileName,
      status: d.status,
      fileUrl: d.fileUrl ?? null,
    })),
    shipment.entryType ?? undefined,
    {}
  );

  const MISSING_DOC_PREFIX = "Missing required document: ";

  const existingMissingDocExceptions = await db.exceptionItem.findMany({
    where: {
      shipmentId: id,
      accountId: ctx.accountId,
      description: { startsWith: MISSING_DOC_PREFIX },
    },
  });

  const missingTypes = new Set(missingDocs.map((d) => d.type));

  // Auto-resolve exceptions for doc types that are now present.
  const nowPresent = existingMissingDocExceptions.filter(
    (ex) => !missingTypes.has((ex.description ?? "").replace(MISSING_DOC_PREFIX, "").split(" — ")[0])
  );
  if (nowPresent.length > 0) {
    await db.exceptionItem.updateMany({
      where: { id: { in: nowPresent.map((e) => e.id) } },
      data: { status: "Resolved" },
    });
  }

  // Create exceptions for missing types that don't already have one.
  const existingDescriptions = new Set(existingMissingDocExceptions.map((e) => e.description ?? ""));
  for (const missing of missingDocs) {
    const description = `${MISSING_DOC_PREFIX}${missing.type} — ${missing.reason}`;
    if (!existingDescriptions.has(description)) {
      await db.exceptionItem.create({
        data: {
          shipmentId: id,
          accountId: ctx.accountId,
          description,
          type: "missing_document",
          severity: missing.blocking ? "High" : "Medium",
          status: "Open",
          category: "DOCUMENT",
          blocking: missing.blocking,
        },
      });
    }
  }

  return NextResponse.json({
    reconciled: true,
    issuesFound: results.length,
    issuesResolved: staleIds.length,
    blockingIssues: blockingCount,
    issues: remainingOpen,
  });

}, { permission: "shipments.manage", write: true });
