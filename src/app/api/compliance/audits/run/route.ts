import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { runAuditChecks, type FilingSnapshotInput } from "@/lib/compliance/auditChecklist";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { filingId } = body;

  // Resolve the target filing — specific if filingId provided, otherwise the most recent
  const filing = await db.customsFiling.findFirst({
    where: filingId ? { id: filingId, accountId: ctx.accountId } : { accountId: ctx.accountId },
    include: {
      shipment: {
        include: { documents: true, lineItems: true },
      },
      snapshot: true,
      bond: true,
    },
    orderBy: filingId ? undefined : { createdAt: "desc" },
});

  if (!filing) {
    return NextResponse.json({ error: "No customs filing found to audit" });
  }

  const lineItems = filing.shipment.lineItems;
  const snapshotData = filing.snapshot?.snapshotData as Record<string, unknown> | null;

  // Resolve the HTS code from the snapshot (what was filed) vs. the current classification
  const snapshotLineItems = Array.isArray(snapshotData?.lineItems)
    ? (snapshotData.lineItems as Array<{ htsCode?: string }>)
    : [];
  const firstSnapshotHts = snapshotLineItems[0]?.htsCode ?? null;
  const firstCurrentHts = lineItems[0]?.htsCode ?? null;

  // Resolve final invoice value via reconciliation records (if any)
  const invoiceReconciliation = await db.reconciliationIssue.findFirst({
    where: { shipmentId: filing.shipmentId, field: { contains: "value" } },
    orderBy: { createdAt: "desc" },
  });
  const finalInvoiceValue = invoiceReconciliation?.actualValue
    ? parseFloat(invoiceReconciliation.actualValue)
    : null;

  // Check whether an AD/CVD order covers the first line item's HTS code
  const htsForAdCvd = firstSnapshotHts;
  let coveredByAdCvd: boolean | null = null;
  if (htsForAdCvd) {
    const normalizedHts = htsForAdCvd.replace(/\D/g, "").slice(0, 8);
    const adCvdOrder = await db.adcvdOrder.findFirst({
      where: {
        htsCodesInScope: { has: normalizedHts },
        status: "ACTIVE",
      },
    }).catch(() => null); // graceful fallback if model doesn't exist yet
    coveredByAdCvd = adCvdOrder !== null ? true : adCvdOrder === null && htsForAdCvd ? false : null;
  }

  // Was the entry classified by a broker? Check for broker.approve transition in AuditLog
  const brokerApprovalLog = await db.auditLog.findFirst({
    where: { entityId: filing.id, action: "filing.approve" },
  });

  const totalValue = filing.totalValue ? Number(filing.totalValue) : null;
  const overFormalEntryThreshold = totalValue !== null ? totalValue > 2500 : null;

  const snapshotInput: FilingSnapshotInput = {
    filingId: filing.id,
    snapshotId: filing.snapshot?.id ?? null,
    snapshotHtsCode: firstSnapshotHts,
    currentHtsCode: firstCurrentHts,
    declaredValue: totalValue,
    finalInvoiceValue,
    coveredByAdCvd,
    bondExpirationDate: filing.bond?.expirationDate ?? null,
    liquidationDate: filing.releasedAt ?? null,
    overFormalEntryThreshold,
    hasBrokerApproval: brokerApprovalLog !== null,
  };

  const checkResults = runAuditChecks(snapshotInput);

  // Map results to ComplianceFinding rows (upsert by filingId + rule to stay idempotent)
  const newFindings: typeof checkResults = [];
  for (const r of checkResults) {
    if (r.result.status === "FAIL") {
      newFindings.push(r);
    }
  }

  for (const finding of newFindings) {
    const existing = await db.complianceFinding.findFirst({
      where: { filingId: filing.id, rule: finding.checkId },
      select: { id: true },
    });
    if (existing) {
      await db.complianceFinding.update({
        where: { id: existing.id },
        data: { description: finding.result.evidence, severity: finding.severity, status: "Open" },
      });
    } else {
      await db.complianceFinding.create({
        data: {
          accountId: ctx.accountId,
          filingId: filing.id,
          rule: finding.checkId,
          severity: finding.severity,
          description: finding.result.evidence,
          recommendation: `Review ${finding.checkName} and take corrective action.`,
          status: "Open",
          confidence: 90,
        },
      });
    }
  }

  // Build the overall ComplianceAuditRecord with typed checklist items
  const checklistItems = checkResults.map((r) => ({
    id: r.checkId,
    name: r.checkName,
    severity: r.severity,
    status: r.result.status,
    evidence: r.result.evidence,
  }));

  const failCount = checkResults.filter((r) => r.result.status === "FAIL").length;
  const evaluatedCount = checkResults.filter((r) => r.result.status !== "NOT_EVALUATED").length;
  const overallResult =
    failCount > 0 ? "Fail" : evaluatedCount === 0 ? "NeedsReview" : "Pass";

  const riskScore =
    evaluatedCount === 0
      ? 100
      : Math.round((failCount / evaluatedCount) * 100);

  const auditRecord = await db.complianceAuditRecord.create({
    data: {
      accountId: ctx.accountId,
      filingId: filing.id,
      auditType: "continuous_compliance_checklist",
      overallResult,
      checklistItems: checklistItems as unknown as Prisma.InputJsonValue,
      riskScore,
      runByAgentName: "Qubere Continuous Compliance Monitor",
    },
    include: { filing: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "compliance_audit.run",
    entity: "ComplianceAuditRecord",
    entityId: auditRecord.id,
    source: "UI",
    metadata: {
      filingId: filing.id,
      overallResult,
      riskScore,
      newFindingsCount: newFindings.length,
    },
  });

  return NextResponse.json(
    {
      auditRecord,
      checkResults,
      newFindingsCount: newFindings.length,
    },
    { status: 201 }
  );

}, { permission: "audits.run", write: true });
