import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { Scale } from "lucide-react";
import { holdsPermission } from "@/modules/party/partyActor";
import { ComplianceWorkspaceClient, type ScreeningBucketData } from "./ComplianceWorkspaceClient";

export const dynamic = "force-dynamic";

const SCREENING_BUCKETS = [
  "COUNTRY_EMBARGO",
  "UFLPA",
  "END_USE_RESTRICTION",
  "END_USER_RESTRICTION",
  "ANTI_BOYCOTT",
  "MILITARY_END_USE",
  "MILITARY_END_USER",
] as const;

export default async function CompliancePage() {
  const context = await getAccountContext();
  if (!context) return null;

  const mayReadPartyScreening = holdsPermission(context, "compliance.restrictedParty.read");

  const [findings, recentAudits, screeningFindings, partyScreeningResults, partySummaryGroups] = await Promise.all([
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
        assignedToUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.complianceAuditRecord.findMany({
      where: { accountId: context.accountId },
      orderBy: { runAt: "desc" },
      take: 25,
      include: { filing: { select: { entryNumber: true } } },
    }),
    // Bounded to the most recent 300 across all six categories -- a browse/
    // monitoring view, not a full unbounded export.
    db.complianceScreeningFinding.findMany({
      where: { accountId: context.accountId },
      include: { shipment: { select: { id: true, shipmentNumber: true, importerName: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    mayReadPartyScreening
      ? db.restrictedPartyScreeningResult.findMany({
          where: { accountId: context.accountId, status: { in: ["HIT", "REVIEW_REQUIRED", "PARTIAL"] } },
          include: {
            matches: true,
            redFlagHits: true,
            disposition: true,
            party: {
              select: {
                id: true,
                internalPartyCode: true,
                names: {
                  where: { status: "ACTIVE" },
                  orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
                  take: 1,
                  select: { rawName: true },
                },
              },
            },
          },
          orderBy: { screeningDate: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    mayReadPartyScreening
      ? db.partyScreeningSummary.groupBy({
          by: ["screeningStatus"],
          where: { accountId: context.accountId },
          _count: true,
        })
      : Promise.resolve([]),
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
    assignedToName: f.assignedToUser ? [f.assignedToUser.firstName, f.assignedToUser.lastName].filter(Boolean).join(" ") || f.assignedToUser.email : null,
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

  const screeningFindingProps = screeningFindings.map((f) => ({
    id: f.id,
    category: f.category,
    ruleId: f.ruleId,
    ruleName: f.ruleName,
    severity: f.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
    details: f.details,
    lineNumber: f.lineNumber,
    status: f.status as "OPEN" | "RESOLVED",
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    shipment: { id: f.shipment.id, shipmentNumber: f.shipment.shipmentNumber, importerName: f.shipment.importerName },
  }));

  const screeningBuckets: Record<string, ScreeningBucketData> = {};
  for (const bucket of SCREENING_BUCKETS) {
    const items = screeningFindingProps.filter((f) => f.category === bucket);
    screeningBuckets[bucket] = {
      items,
      openCount: items.filter((f) => f.status === "OPEN").length,
    };
  }

  const partyScreeningProps = partyScreeningResults.map((r) => ({
    id: r.id,
    passType: r.passType,
    status: r.status,
    screenedName: r.screenedName,
    screeningDate: r.screeningDate.toISOString(),
    hitCount: r.hitCount,
    redFlagCount: r.redFlagCount,
    party: r.party
      ? { id: r.party.id, internalPartyCode: r.party.internalPartyCode, displayName: r.party.names[0]?.rawName ?? r.party.internalPartyCode ?? "Unnamed party" }
      : null,
    matches: r.matches.map((m) => ({ id: m.id, matchedName: m.matchedName, sourceList: m.sourceList, nameScore: m.nameScore })),
    redFlagHits: r.redFlagHits.map((h) => ({ id: h.id, matchedWord: h.matchedWord })),
    disposition: r.disposition ? { status: r.disposition.status } : null,
  }));

  const partySummaryCounts: Record<string, number> = {};
  for (const group of partySummaryGroups) {
    partySummaryCounts[group.screeningStatus] = group._count;
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
          <Scale className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Compliance Workspace</h1>
          <p className="text-xs text-ink-muted">Screening, review, and audit history across every shipment</p>
        </div>
      </div>

      <ComplianceWorkspaceClient
        findings={findingProps}
        recentAudits={auditProps}
        screeningBuckets={screeningBuckets}
        mayReadPartyScreening={mayReadPartyScreening}
        partyScreeningResults={partyScreeningProps}
        partySummaryCounts={partySummaryCounts}
      />
    </div>
  );
}
