import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { recordUsageEvent } from "@/lib/billing/telemetry";
import { reconcileShipment } from "@/modules/reconciliation/reconcileRules";
import { buildReviewFields } from "@/modules/documents/extractionReview";

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await req.json();
  const { shipmentId } = body;

  if (typeof shipmentId !== "string" || shipmentId.trim() === "") {
    return NextResponse.json({ error: "shipmentId is required" }, { status: 400 });
  }

  const targetShipmentId = shipmentId;
  const shipment = await db.shipment.findFirst({
    where: { id: targetShipmentId, accountId: ctx.accountId },
    include: { documents: true, lineItems: true },
  });

  if (!shipment) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });

  const extractions = await db.extractionField.findMany({
    where: { documentId: { in: shipment.documents.map((d) => d.id) } },
  });

  const rowsByDocument = new Map<string, typeof extractions>();
  for (const doc of shipment.documents) rowsByDocument.set(doc.id, []);
  for (const field of extractions) rowsByDocument.get(field.documentId)?.push(field);

  const fieldsByDocument = new Map<string, Record<string, string>>();
  for (const doc of shipment.documents) {
    const bucket: Record<string, string> = {};
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
    lineItems: (shipment.lineItems || []).map((l) => ({ countryOfOrigin: l.countryOfOrigin, description: l.description })),
    incoterm: shipment.incoterm,
  });

  const evaluatedFields = new Set(evaluatedList);
  const openBefore = await db.reconciliationIssue.findMany({
    where: { shipmentId: targetShipmentId, accountId: ctx.accountId, status: "Open" },
  });

  for (const detection of detections) {
    const existing = openBefore.find((i) => i.field === detection.field);
    if (existing) {
      await db.reconciliationIssue.update({ where: { id: existing.id }, data: detection });
    } else {
      await db.reconciliationIssue.create({
        data: { ...detection, shipmentId: targetShipmentId, accountId: ctx.accountId, status: "Open" },
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
    source: "UI",
    metadata: { openIssueCount: openIssues.length, resolvedCount: staleIds.length },
  });

  const hasCritical = openIssues.some((i) => i.severity === "Critical");
  const status = hasCritical
    ? "BLOCKED"
    : openIssues.length > 0
      ? "WARNINGS"
      : skippedChecks.length > 0
        ? "INCOMPLETE"
        : "MATCHED";

  try {
    await recordUsageEvent({
      accountId: ctx.accountId,
      eventCode: "RECONCILIATION_COMPLETED",
      clientId: shipment.clientId ?? undefined,
      importerId: shipment.importerOfRecordId ?? undefined,
      shipmentId: shipment.id,
      userId: ctx.userId,
      quantity: 1,
      unit: "shipment",
      sourceFunction: "reconcileShipment",
      sourceApi: "/api/reconcile",
      success: true,
      automated: true,
      idempotencyKey: `billing:reconciliation:${requestId}`,
      metadata: { status, issuesCount: openIssues.length, criticalCount: openIssues.filter((i) => i.severity === "Critical").length },
    });
  } catch (billingError) {
    console.error("Failed to record reconciliation billing usage", billingError);
  }

  return NextResponse.json({
    reconciliation: {
      shipmentId: targetShipmentId,
      status,
      reconciliationScore: skippedChecks.length > 0 ? null : Math.max(0, 100 - openIssues.length * 20),
      skippedChecks,
      issuesCount: openIssues.length,
      criticalCount: openIssues.filter((i) => i.severity === "Critical").length,
      issues: openIssues,
    },
  });
}, { permission: "shipments.manage", write: true });
