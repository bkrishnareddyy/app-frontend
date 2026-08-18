import { inngest } from "../client";
import { db } from "@/lib/db";
import { runAuditChecks, type FilingSnapshotInput } from "@/lib/compliance/auditChecklist";
import { createAuditLog, AuditAction } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

export async function executeDailyComplianceAudit() {
  const accounts = await db.account.findMany({ select: { id: true } });
  let totalEvaluated = 0;
  let totalFindingsCreated = 0;

  for (const account of accounts) {
    const filings = await db.customsFiling.findMany({
      where: { accountId: account.id },
      include: {
        shipment: {
          include: { lineItems: true },
        },
        snapshot: true,
        bond: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    for (const filing of filings) {
      totalEvaluated++;
      const lineItems = filing.shipment?.lineItems ?? [];
      const snapshotData = filing.snapshot?.snapshotData as Record<string, unknown> | null;
      const snapshotLineItems = Array.isArray(snapshotData?.lineItems)
        ? (snapshotData.lineItems as Array<{ htsCode?: string }>)
        : [];
      const firstSnapshotHts = snapshotLineItems[0]?.htsCode ?? null;
      const firstCurrentHts = lineItems[0]?.htsCode ?? null;

      const invoiceReconciliation = filing.shipmentId
        ? await db.reconciliationIssue.findFirst({
            where: { shipmentId: filing.shipmentId, field: { contains: "value" } },
            orderBy: { createdAt: "desc" },
          })
        : null;
      const finalInvoiceValue = invoiceReconciliation?.actualValue
        ? parseFloat(invoiceReconciliation.actualValue)
        : null;

      const htsForAdCvd = firstSnapshotHts;
      let coveredByAdCvd: boolean | null = null;
      if (htsForAdCvd) {
        const normalizedHts = htsForAdCvd.replace(/\D/g, "").slice(0, 8);
        const adCvdOrder = await db.adcvdOrder.findFirst({
          where: {
            htsCodesInScope: { has: normalizedHts },
            status: "ACTIVE",
          },
        }).catch(() => null);
        coveredByAdCvd = adCvdOrder !== null ? true : adCvdOrder === null && htsForAdCvd ? false : null;
      }

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
      const newFindings = checkResults.filter((r) => r.result.status === "FAIL");

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
              accountId: account.id,
              filingId: filing.id,
              rule: finding.checkId,
              severity: finding.severity,
              description: finding.result.evidence,
              recommendation: `Review ${finding.checkName} and take corrective action.`,
              status: "Open",
              confidence: 90,
            },
          });
          totalFindingsCreated++;
        }
      }

      const checklistItems = checkResults.map((r) => ({
        id: r.checkId,
        name: r.checkName,
        severity: r.severity,
        status: r.result.status,
        evidence: r.result.evidence,
      }));

      const failCount = checkResults.filter((r) => r.result.status === "FAIL").length;
      const evaluatedCount = checkResults.filter((r) => r.result.status !== "NOT_EVALUATED").length;
      const overallResult = failCount > 0 ? "Fail" : evaluatedCount === 0 ? "NeedsReview" : "Pass";
      const riskScore = evaluatedCount === 0 ? 100 : Math.round((failCount / evaluatedCount) * 100);

      const auditRecord = await db.complianceAuditRecord.create({
        data: {
          accountId: account.id,
          filingId: filing.id,
          auditType: "continuous_compliance_checklist",
          overallResult,
          checklistItems: checklistItems as unknown as Prisma.InputJsonValue,
          riskScore,
          runByAgentName: "Qubere Continuous Compliance Inngest Job",
        },
      });

      await createAuditLog({
        accountId: account.id,
        action: AuditAction.COMPLIANCE_AUDIT_RUN,
        entity: "ComplianceAuditRecord",
        entityId: auditRecord.id,
        source: "SYSTEM",
        metadata: {
          filingId: filing.id,
          overallResult,
          riskScore,
          newFindingsCount: newFindings.length,
          triggeredBy: "InngestCron",
        },
      });
    }
  }

  return { totalEvaluated, totalFindingsCreated };
}

export const dailyComplianceAuditJob = (inngest.createFunction as any)(
  { id: "daily-compliance-audit", triggers: [{ cron: "0 0 * * *" }] },
  async ({ step }: { step: any }) => {
    const result = await step.run("run-compliance-audits", async () => {
      return await executeDailyComplianceAudit();
    });
    return result;
  }
);
