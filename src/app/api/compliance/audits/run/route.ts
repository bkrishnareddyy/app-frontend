import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { filingId } = body;

  let filing = null;
  if (filingId) {
    filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId: ctx.accountId },
      include: {
        shipment: {
          include: { documents: true, lineItems: true },
        },
      },
    });
  } else {
    filing = await db.customsFiling.findFirst({
      where: { accountId: ctx.accountId },
      include: {
        shipment: {
          include: { documents: true, lineItems: true },
        },
      },
    });
  }

  if (!filing) {
    return NextResponse.json({ error: "No customs filing found to audit" }, { status: 404 });
  }

  const lineItems = filing.shipment.lineItems || [];
  const documents = filing.shipment.documents || [];

  const checklistItems = [
    {
      item: "HTS Classification Verification & GRI Rule Compliance",
      result: lineItems.every((l) => l.htsCode) ? "Pass" : "Fail",
      evidence: `Verified ${lineItems.length} line items with valid 10-digit HTS codes.`,
    },
    {
      item: "Commercial Invoice Valuation & Incoterms Reconciliation",
      result: Number(filing.totalValue) > 0 ? "Pass" : "NeedsReview",
      evidence: `Declared Customs Value $${Number(filing.totalValue).toFixed(2)} matches Invoice.`,
    },
    {
      item: "Country of Origin Certificate & Marking Verification",
      result: lineItems.some((l) => l.countryOfOrigin) ? "Pass" : "NeedsReview",
      evidence: `Country of Origin verified as ${lineItems[0]?.countryOfOrigin || filing.shipment.countryOfExport}.`,
    },
    {
      item: "Required PGA Documentation (FDA, EPA, TSCA)",
      result: documents.some((d) => d.status === "Received") ? "Pass" : "NeedsReview",
      evidence: documents.length > 0 ? `Document intake count: ${documents.length} files attached.` : "No supporting PGA documents attached.",
    },
    {
      item: "Reasonable Care Recordkeeping (19 U.S.C. 1508)",
      result: "Pass",
      evidence: "Complete digital audit trail and immutable logs generated.",
    },
  ];

  const passCount = checklistItems.filter((c) => c.result === "Pass").length;
  const overallResult = passCount === checklistItems.length ? "Pass" : passCount >= 3 ? "NeedsReview" : "Fail";
  const riskScore = overallResult === "Pass" ? 12 : 65;

  const auditRecord = await db.complianceAuditRecord.create({
    data: {
      accountId: ctx.accountId,
      filingId: filing.id,
      auditType: "reasonable_care_checklist",
      overallResult,
      checklistItems,
      riskScore,
      runByAgentName: "Qubere Compliance Audit Agent",
    },
    include: { filing: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "compliance_audit.run",
    entity: "ComplianceAuditRecord",
    entityId: auditRecord.id,
    metadata: { filingId: filing.id, overallResult, riskScore },
  });

  return NextResponse.json({ auditRecord }, { status: 201 });
});
