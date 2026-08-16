"use client";

import { useEffect, useState } from "react";
import { LayoutDashboard, Search, ListChecks, Clock } from "lucide-react";
import { ComplianceFindingsClient } from "./ComplianceFindingsClient";
import { ScreeningPanel, type ScreeningFindingProps, type PartyScreeningResultProps } from "./ScreeningPanel";
import { OverviewPanel } from "./OverviewPanel";
import { AuditHistoryPanel, type AuditRecordProps } from "./AuditHistoryPanel";

export type ScreeningBucketData = {
  items: ScreeningFindingProps[];
  openCount: number;
};

interface FindingProps {
  id: string;
  filingId: string;
  rule: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  recommendation: string | null;
  status: string;
  confidence: number | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  filing: {
    id: string;
    entryNumber: string;
    filingStatus: string;
    shipmentNumber: string;
    importerName: string;
  } | null;
}

interface ComplianceWorkspaceClientProps {
  findings: FindingProps[];
  recentAudits: AuditRecordProps[];
  screeningBuckets: Record<string, ScreeningBucketData>;
  mayReadPartyScreening: boolean;
  partyScreeningResults: PartyScreeningResultProps[];
  partySummaryCounts: Record<string, number>;
}

type WorkspaceTab = "overview" | "screening" | "review" | "audit";

function normalizeTab(tab: string | null): WorkspaceTab {
  return tab === "screening" || tab === "review" || tab === "audit" ? tab : "overview";
}

const TOP_TABS: { id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "screening", label: "Screening", icon: Search },
  { id: "review", label: "Review Queue", icon: ListChecks },
  { id: "audit", label: "Audit History", icon: Clock },
];

export function ComplianceWorkspaceClient({
  findings,
  recentAudits,
  screeningBuckets,
  mayReadPartyScreening,
  partyScreeningResults,
  partySummaryCounts,
}: ComplianceWorkspaceClientProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");

  useEffect(() => {
    setActiveTab(normalizeTab(new URLSearchParams(window.location.search).get("tab")));
  }, []);

  const selectTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  };

  const openFindingsCount = findings.filter((f) => f.status !== "Resolved").length;
  const partyReviewCount = partyScreeningResults.filter((r) => !r.disposition || r.disposition.status === "PENDING").length;
  const screeningOpenTotal = Object.values(screeningBuckets).reduce((sum, b) => sum + b.openCount, 0) + (mayReadPartyScreening ? partyReviewCount : 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 pt-2 border-t border-border">
        {TOP_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
              activeTab === id ? "bg-brand text-white" : "bg-slate-100 text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
            {id === "screening" && screeningOpenTotal > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] ${activeTab === id ? "bg-white/20" : "bg-slate-200"}`}>
                {screeningOpenTotal}
              </span>
            )}
            {id === "review" && openFindingsCount > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] ${activeTab === id ? "bg-white/20" : "bg-slate-200"}`}>
                {openFindingsCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div key={activeTab} className="space-y-6">
        {activeTab === "overview" && (
          <OverviewPanel
            findings={findings}
            screeningBuckets={screeningBuckets}
            mayReadPartyScreening={mayReadPartyScreening}
            partySummaryCounts={partySummaryCounts}
            onNavigate={selectTab}
          />
        )}
        {activeTab === "screening" && (
          <ScreeningPanel
            screeningBuckets={screeningBuckets}
            mayReadPartyScreening={mayReadPartyScreening}
            partyScreeningResults={partyScreeningResults}
          />
        )}
        {activeTab === "review" && <ComplianceFindingsClient findings={findings} recentAudits={[]} />}
        {activeTab === "audit" && <AuditHistoryPanel recentAudits={recentAudits} />}
      </div>
    </div>
  );
}

export type { FindingProps };
