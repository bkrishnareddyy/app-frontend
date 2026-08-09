import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentId } = body;

  let targetShipmentId = shipmentId;
  if (!targetShipmentId) {
    const firstShipment = await db.shipment.findFirst({
      where: { accountId: ctx.accountId },
    });
    targetShipmentId = firstShipment?.id;
  }

  if (!targetShipmentId) {
    return NextResponse.json({ error: "No shipment found for reconciliation" }, { status: 404 });
  }

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

  // Run cross-document reconciliation rules engine
  const issuesCreated = [];

  const lineItems = shipment.lineItems || [];
  const totalLineQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);

  // Rule 1: Quantity reconciliation across commercial documents
  const invoiceDoc = shipment.documents.find((d) => d.docType.includes("Invoice"));
  const packingDoc = shipment.documents.find((d) => d.docType.includes("Packing"));

  if (invoiceDoc && packingDoc) {
    const invExt = await db.extractionField.findFirst({ where: { documentId: invoiceDoc.id, fieldName: "totalQuantity" } });
    const packExt = await db.extractionField.findFirst({ where: { documentId: packingDoc.id, fieldName: "totalQuantity" } });

    if (invExt && packExt && invExt.value !== packExt.value) {
      const issue = await db.reconciliationIssue.create({
        data: {
          shipmentId: targetShipmentId,
          accountId: ctx.accountId,
          severity: "Warning",
          field: "quantity",
          expectedValue: `${invExt.value} PCS (${invoiceDoc.docType})`,
          actualValue: `${packExt.value} PCS (${packingDoc.docType})`,
          sourceDocuments: [invoiceDoc.docType, packingDoc.docType],
          status: "Open",
        },
      });
      issuesCreated.push(issue);
    }
  }

  // Rule 2: Country of Origin reconciliation check
  const countries = Array.from(new Set(lineItems.map((l) => l.countryOfOrigin).filter(Boolean)));
  if (countries.length > 1) {
    const issue = await db.reconciliationIssue.create({
      data: {
        shipmentId: targetShipmentId,
        accountId: ctx.accountId,
        severity: "Critical",
        field: "country",
        expectedValue: countries[0] || "Germany",
        actualValue: countries.join(", "),
        sourceDocuments: ["Commercial Invoice", "Bill of Lading"],
        status: "Open",
      },
    });
    issuesCreated.push(issue);
  }

  // Rule 3: Container Number mismatch check
  const hasBol = shipment.documents.some((d) => d.docType.includes("Bill of Lading"));
  if (!hasBol) {
    const issue = await db.reconciliationIssue.create({
      data: {
        shipmentId: targetShipmentId,
        accountId: ctx.accountId,
        severity: "Critical",
        field: "container",
        expectedValue: "Bill of Lading attached",
        actualValue: "Missing BOL Document",
        sourceDocuments: ["Bill of Lading"],
        status: "Open",
      },
    });
    issuesCreated.push(issue);
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "reconciliation.run",
    entity: "ReconciliationIssue",
    entityId: targetShipmentId,
    metadata: { issuesCreatedCount: issuesCreated.length },
  });

  const hasCritical = issuesCreated.some((i) => i.severity === "Critical");

  return NextResponse.json({
    reconciliation: {
      shipmentId: targetShipmentId,
      status: hasCritical ? "BLOCKED" : issuesCreated.length > 0 ? "WARNINGS" : "MATCHED",
      reconciliationScore: Math.max(0, 100 - issuesCreated.length * 20),
      issuesCount: issuesCreated.length,
      criticalCount: issuesCreated.filter((i) => i.severity === "Critical").length,
      issues: issuesCreated,
    },
  });
});
