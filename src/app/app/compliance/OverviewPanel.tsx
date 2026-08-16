"use client";

import { AlertTriangle, CheckCircle2, Search, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { ScreeningBucketData } from "./ComplianceWorkspaceClient";

interface FindingProps {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: string;
}

interface OverviewPanelProps {
  findings: FindingProps[];
  screeningBuckets: Record<string, ScreeningBucketData>;
  mayReadPartyScreening: boolean;
  partySummaryCounts: Record<string, number>;
  onNavigate: (tab: "overview" | "screening" | "review" | "audit") => void;
}

const SEVERITY_ORDER: FindingProps["severity"][] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const SEVERITY_STYLES: Record<FindingProps["severity"], string> = {
  CRITICAL: "bg-red-50 border-red-200 text-red-800",
  HIGH: "bg-orange-50 border-orange-200 text-orange-800",
  MEDIUM: "bg-amber-50 border-amber-200 text-amber-800",
  LOW: "bg-blue-50 border-blue-200 text-blue-800",
};

const SCREENING_LABELS: Record<string, string> = {
  COUNTRY_EMBARGO: "Country Embargo",
  UFLPA: "Forced Labor / UFLPA",
  END_USE_RESTRICTION: "End-Use",
  END_USER_RESTRICTION: "End-User",
  ANTI_BOYCOTT: "Anti-Boycott",
  MILITARY_END_USE: "Military End-Use",
  MILITARY_END_USER: "Military End-User",
};

export function OverviewPanel({ findings, screeningBuckets, mayReadPartyScreening, partySummaryCounts, onNavigate }: OverviewPanelProps) {
  const openFindings = findings.filter((f) => f.status !== "Resolved");
  const severityCounts = SEVERITY_ORDER.reduce<Record<string, number>>((acc, sev) => {
    acc[sev] = openFindings.filter((f) => f.severity === sev).length;
    return acc;
  }, {});

  const screeningOpenTotal = Object.values(screeningBuckets).reduce((sum, b) => sum + b.openCount, 0);
  const partyHitCount = partySummaryCounts["HIT"] ?? 0;
  const partyReviewCount = partySummaryCounts["REVIEW_REQUIRED"] ?? 0;

  const criticalCount = severityCounts.CRITICAL ?? 0;
  const highCount = severityCounts.HIGH ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {SEVERITY_ORDER.map((sev) => (
          <Card key={sev} className={`text-center py-4 ${SEVERITY_STYLES[sev]}`}>
            <p className="text-2xl font-extrabold">{severityCounts[sev] ?? 0}</p>
            <p className="text-xs font-bold uppercase tracking-wider mt-1">{sev}</p>
          </Card>
        ))}
      </div>

      {criticalCount + highCount > 0 ? (
        <span className="flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-3 py-1.5 w-fit">
          <AlertTriangle className="w-3.5 h-3.5" />
          {criticalCount + highCount} critical or high finding(s) require attention
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 w-fit">
          <CheckCircle2 className="w-3.5 h-3.5" />
          No critical or high findings open
        </span>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button type="button" onClick={() => onNavigate("screening")} className="text-left cursor-pointer">
          <Card className="space-y-2 hover:border-brand transition-colors">
            <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-brand" />
              <span>Screening</span>
            </h3>
            <p className="text-2xl font-extrabold text-ink">{screeningOpenTotal + (mayReadPartyScreening ? partyHitCount + partyReviewCount : 0)}</p>
            <p className="text-xs text-ink-muted">open finding(s) across all screening categories</p>
            {mayReadPartyScreening && (partyHitCount > 0 || partyReviewCount > 0) && (
              <p className="text-[11px] text-ink-muted">{partyHitCount} party hit(s), {partyReviewCount} pending review</p>
            )}
            <div className="pt-1 space-y-1">
              {Object.entries(screeningBuckets)
                .filter(([, b]) => b.openCount > 0)
                .map(([cat, b]) => (
                  <div key={cat} className="flex items-center justify-between text-[11px] text-ink-muted">
                    <span>{SCREENING_LABELS[cat] ?? cat}</span>
                    <span className="font-bold text-ink">{b.openCount}</span>
                  </div>
                ))}
            </div>
          </Card>
        </button>

        <button type="button" onClick={() => onNavigate("review")} className="text-left cursor-pointer">
          <Card className="space-y-2 hover:border-brand transition-colors">
            <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
              <ListChecks className="w-3.5 h-3.5 text-brand" />
              <span>Review Queue</span>
            </h3>
            <p className="text-2xl font-extrabold text-ink">{openFindings.length}</p>
            <p className="text-xs text-ink-muted">open filing-level finding(s) awaiting resolution</p>
          </Card>
        </button>
      </div>
    </div>
  );
}
