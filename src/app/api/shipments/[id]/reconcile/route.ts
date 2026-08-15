import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
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
  // C-1: For every issue found, also maintain a parallel ExceptionItem with
  // category "CONFLICT" so conflict issues surface in the unified Exceptions tab.
  const CONFLICT_CODE_PREFIX = "CONFLICT:";

  for (const result of results) {
    const existing = openIssues.find((i) => i.field === result.ruleId);
    const severity = severityMap[result.severity] ?? "Warning";
    const data = {
      field: result.ruleId,
      severity,
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

    // Sync ExceptionItem for this conflict rule.
    const exCode = `${CONFLICT_CODE_PREFIX}${result.ruleId}`;
    const exSeverity = result.severity === "BLOCKING" ? "High" : result.severity === "WARNING" ? "Medium" : "Low";
    const exDescription = `Value conflict on "${result.ruleId}": ${result.docTypeA} reports "${result.valueA}" but ${result.docTypeB} reports "${result.valueB}".`;
    const existingEx = await db.exceptionItem.findFirst({
      where: { shipmentId: id, accountId: ctx.accountId, code: exCode, status: { not: "Resolved" } },
      select: { id: true },
    });
    if (!existingEx) {
      await db.exceptionItem.create({
        data: {
          shipmentId: id,
          accountId: ctx.accountId,
          code: exCode,
          category: "CONFLICT",
          type: "data_mismatch",
          severity: exSeverity,
          blocking: result.severity === "BLOCKING",
          description: exDescription,
          requiredAction: "Review both source documents and accept the correct value, or flag both as wrong.",
          sourceAgent: "Reconciliation Engine",
        },
      });
    } else {
      await db.exceptionItem.update({
        where: { id: existingEx.id },
        data: { severity: exSeverity, description: exDescription, blocking: result.severity === "BLOCKING" },
      });
    }
  }

  // Auto-resolve issues for rules that ran cleanly this time.
  const resolvedRuleIds = new Set(results.map((r) => r.ruleId));
  const staleIssues = openIssues.filter(
    (i) => evaluatedFields.has(i.field) && !resolvedRuleIds.has(i.field)
  );
  const staleIds = staleIssues.map((i) => i.id);

  if (staleIds.length > 0) {
    await db.reconciliationIssue.updateMany({
      where: { id: { in: staleIds } },
      data: { status: "Resolved", resolvedAt: new Date() },
    });
    // Also auto-resolve the paired ExceptionItems.
    const staleCodes = staleIssues.map((i) => `${CONFLICT_CODE_PREFIX}${i.field}`);
    await db.exceptionItem.updateMany({
      where: { shipmentId: id, accountId: ctx.accountId, code: { in: staleCodes }, status: { not: "Resolved" } },
      data: { status: "Resolved", resolvedAt: new Date(), resolvedBy: "SYSTEM", resolvedByName: "Reconciliation Engine" },
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
  await recomputeShipmentDeadlines(id, ctx.accountId);

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

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.RECONCILIATION_RUN,
    entity: "Shipment",
    entityId: id,
    source: "UI",
    metadata: {
      issuesFound: results.length,
      issuesAutoResolved: staleIds.length,
      blockingIssues: blockingCount,
      readinessScore: totalScore,
    },
  });

  return NextResponse.json({
    reconciled: true,
    issuesFound: results.length,
    issuesResolved: staleIds.length,
    blockingIssues: blockingCount,
    issues: remainingOpen,
  });

}, { permission: "shipments.manage", write: true });
