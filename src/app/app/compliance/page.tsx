import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { Scale } from "lucide-react";
import { ComplianceFindingsClient } from "./ComplianceFindingsClient";

export default async function CompliancePage() {
  const context = await getAccountContext();
  if (!context) return null;

  const [findings, recentAudits] = await Promise.all([
    db.complianceFinding.findMany({
      where: { accountId: context.accountId },
      include: {
        filing: {
          select: {
            id: true,
            entryNumber: true,
            filingStatus: true,
            shipment: { select: { shipmentNumber: true, importerName: true } },
          },
        },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.complianceAuditRecord.findMany({
      where: { accountId: context.accountId },
      orderBy: { runAt: "desc" },
      take: 5,
      include: { filing: { select: { entryNumber: true } } },
    }),
  ]);

  const findingProps = findings.map((f) => ({
    id: f.id,
    filingId: f.filingId,
    rule: f.rule,
    severity: f.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
    description: f.description,
    recommendation: f.recommendation,
    status: f.status,
    confidence: f.confidence,
    assignedToUserId: f.assignedToUserId,
    assignedToName: f.assignedTo?.name ?? null,
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    filing: f.filing
      ? {
          id: f.filing.id,
          entryNumber: f.filing.entryNumber,
          filingStatus: f.filing.filingStatus,
          shipmentNumber: f.filing.shipment.shipmentNumber,
          importerName: f.filing.shipment.importerName,
        }
      : null,
  }));

  const auditProps = recentAudits.map((a) => ({
    id: a.id,
    auditType: a.auditType,
    overallResult: a.overallResult,
    riskScore: a.riskScore,
    runAt: a.runAt.toISOString(),
    runByAgentName: a.runByAgentName,
    entryNumber: a.filing?.entryNumber ?? null,
  }));

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
          <Scale className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Compliance Monitoring</h1>
          <p className="text-xs text-ink-muted">Continuous post-filing audit findings across all entries</p>
        </div>
      </div>

      <ComplianceFindingsClient findings={findingProps} recentAudits={auditProps} />
    </div>
  );
}
