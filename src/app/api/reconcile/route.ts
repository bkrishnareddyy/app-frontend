import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { reconcileShipment } from "@/modules/reconciliation/reconcileRules";
import { buildReviewFields } from "@/modules/documents/extractionReview";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentId } = body;

  // This used to fall back to findFirst() and write issue rows against whichever
  // shipment came back, so a request with no id reconciled an arbitrary shipment.
  if (typeof shipmentId !== "string" || shipmentId.trim() === "") {
    return NextResponse.json({ error: "shipmentId is required" }, { status: 400 });
  }

  const targetShipmentId = shipmentId;

  const shipment = await db.shipment.findFirst({
    where: { id: targetShipmentId, accountId: ctx.accountId },
    include: {
      documents: true,
      lineItems: true,
    },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Run cross-document reconciliation rules engine.
  // The rules are pure; this handler only supplies what the documents declare.
  const extractions = await db.extractionField.findMany({
    where: { documentId: { in: shipment.documents.map((d) => d.id) } },
  });

  const rowsByDocument = new Map<string, typeof extractions>();
  for (const doc of shipment.documents) rowsByDocument.set(doc.id, []);
  for (const field of extractions) {
    rowsByDocument.get(field.documentId)?.push(field);
  }

  const fieldsByDocument = new Map<string, Record<string, string>>();
  for (const doc of shipment.documents) {
    const bucket: Record<string, string> = {};
    // buildReviewFields decides which reading is current: a reviewer's correction
    // beats the model outright, and confidence only ranks machine readings.
    // Ordering by `confidence DESC` in SQL put unscored rows first on Postgres.
    for (const field of buildReviewFields(rowsByDocument.get(doc.id) ?? [])) {
      bucket[field.fieldName] = field.currentValue;
    }
    fieldsByDocument.set(doc.id, bucket);
  }

  const { detections, evaluatedFields: evaluatedList, skippedChecks } = reconcileShipment({
    documents: shipment.documents.map((doc) => ({
      id: doc.id,
      docType: doc.docType,
      fields: fieldsByDocument.get(doc.id) ?? {},
    })),
    lineItems: (shipment.lineItems || []).map((l) => ({
      countryOfOrigin: l.countryOfOrigin,
      description: l.description,
    })),
    incoterm: shipment.incoterm,
  });

  // Only a rule that actually completed may close its own outstanding issue.
  const evaluatedFields = new Set(evaluatedList);

  const openBefore = await db.reconciliationIssue.findMany({
    where: { shipmentId: targetShipmentId, accountId: ctx.accountId, status: "Open" },
  });

  // Re-running used to append a second copy of every discrepancy the rules still
  // detect, so the issue list grew by one row per run per rule.
  for (const detection of detections) {
    const existing = openBefore.find((i) => i.field === detection.field);
    if (existing) {
      await db.reconciliationIssue.update({ where: { id: existing.id }, data: detection });
    } else {
      await db.reconciliationIssue.create({
        data: {
          ...detection,
          shipmentId: targetShipmentId,
          accountId: ctx.accountId,
          status: "Open",
        },
      });
    }
  }

  const staleIds = openBefore
    .filter((i) => evaluatedFields.has(i.field) && !detections.some((d) => d.field === i.field))
    .map((i) => i.id);

  if (staleIds.length > 0) {
    await db.reconciliationIssue.updateMany({
      where: { id: { in: staleIds } },
      data: { status: "Resolved", resolvedAt: new Date() },
    });
  }

  // The response used to describe only the rows this run created, so a shipment
  // carrying unresolved Critical issues from an earlier run reported MATCHED.
  const openIssues = await db.reconciliationIssue.findMany({
    where: { shipmentId: targetShipmentId, accountId: ctx.accountId, status: "Open" },
    orderBy: { createdAt: "asc" },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "reconciliation.run",
    entity: "ReconciliationIssue",
    entityId: targetShipmentId,
    metadata: { openIssueCount: openIssues.length, resolvedCount: staleIds.length },
  });

  const hasCritical = openIssues.some((i) => i.severity === "Critical");

  return NextResponse.json({
    reconciliation: {
      shipmentId: targetShipmentId,
      status: hasCritical
        ? "BLOCKED"
        : openIssues.length > 0
          ? "WARNINGS"
          : skippedChecks.length > 0
            ? "INCOMPLETE"
            : "MATCHED",
      // Null rather than 100 when a rule was skipped: the shipment was not cleared.
      reconciliationScore:
        skippedChecks.length > 0 ? null : Math.max(0, 100 - openIssues.length * 20),
      skippedChecks,
      issuesCount: openIssues.length,
      criticalCount: openIssues.filter((i) => i.severity === "Critical").length,
      issues: openIssues,
    },
  });
}, { write: true });
