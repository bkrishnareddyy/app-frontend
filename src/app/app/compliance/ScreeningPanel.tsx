"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { displayDate } from "@/lib/honest";
import type { ScreeningBucketData } from "./ComplianceWorkspaceClient";

export interface ScreeningFindingProps {
  id: string;
  category: string;
  ruleId: string;
  ruleName: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  details: string;
  lineNumber: number | null;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
  shipment: { id: string; shipmentNumber: string; importerName: string };
}

export interface PartyScreeningResultProps {
  id: string;
  passType: string;
  status: string;
  screenedName: string;
  screeningDate: string;
  hitCount: number;
  redFlagCount: number;
  party: { id: string; internalPartyCode: string | null; displayName: string } | null;
  matches: { id: string; matchedName: string; sourceList: string; nameScore: number }[];
  redFlagHits: { id: string; matchedWord: string }[];
  disposition: { status: string } | null;
}

interface ScreeningPanelProps {
  screeningBuckets: Record<string, ScreeningBucketData>;
  mayReadPartyScreening: boolean;
  partyScreeningResults: PartyScreeningResultProps[];
}

type SubTab = "party" | "embargo" | "uflpa" | "endUse" | "military" | "antiBoycott";

const SEVERITY_BADGE: Record<string, BadgeProps["variant"]> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "warning",
  LOW: "info",
};

function statusBadge(status: string): BadgeProps["variant"] {
  if (status === "HIT") return "danger";
  if (status === "REVIEW_REQUIRED" || status === "PARTIAL") return "warning";
  if (status === "CLEAR") return "success";
  return "neutral";
}

function ScreeningFindingRow({ finding }: { finding: ScreeningFindingProps }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const isResolved = finding.status === "RESOLVED";

  const handleResolve = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/screening-findings/${finding.id}/resolve`, { method: "POST" });
      if (res.ok) router.refresh();
    } catch (err) {
      console.error("Error resolving screening finding", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2 text-xs bg-surface ${isResolved ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={SEVERITY_BADGE[finding.severity]}>{finding.severity}</Badge>
          <span className="font-mono text-[11px] text-ink-muted">{finding.ruleId}</span>
          {isResolved && <Badge variant="success">Resolved</Badge>}
        </div>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-ink-muted hover:text-ink" aria-label={expanded ? "Collapse" : "Expand"}>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="font-medium text-ink leading-snug">{finding.ruleName}</p>
      <div className="flex items-center gap-2 flex-wrap text-ink-muted">
        <Link href={`/app/shipments/${finding.shipment.id}`} className="text-brand font-semibold hover:underline">
          {finding.shipment.shipmentNumber}
        </Link>
        <span>&middot;</span>
        <span>{finding.shipment.importerName}</span>
        {finding.lineNumber !== null && (
          <>
            <span>&middot;</span>
            <span>Line {finding.lineNumber}</span>
          </>
        )}
      </div>
      {expanded && (
        <div className="pt-2 border-t border-border space-y-2">
          <p className="text-ink-muted">{finding.details}</p>
          <div className="flex items-center gap-4 text-[10px] text-ink-muted flex-wrap">
            <span>Detected {displayDate(finding.createdAt)}</span>
            {finding.resolvedAt && <span>Resolved {displayDate(finding.resolvedAt)}</span>}
          </div>
          {!isResolved && (
            <button
              type="button"
              disabled={busy}
              onClick={handleResolve}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>{busy ? "Saving..." : "Mark Resolved"}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingsList({ items }: { items: ScreeningFindingProps[] }) {
  if (items.length === 0) {
    return (
      <Card className="text-center py-10 space-y-2">
        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
        <p className="text-sm font-bold text-ink">No findings in this category</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((f) => (
        <ScreeningFindingRow key={f.id} finding={f} />
      ))}
    </div>
  );
}

function PartyScreeningList({ results }: { results: PartyScreeningResultProps[] }) {
  if (results.length === 0) {
    return (
      <Card className="text-center py-10 space-y-2">
        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
        <p className="text-sm font-bold text-ink">No open party screening hits</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div key={r.id} className="rounded-xl border border-border p-3 space-y-2 text-xs bg-surface">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={statusBadge(r.status)}>{r.status.replace(/_/g, " ")}</Badge>
              <span className="font-medium text-ink">{r.screenedName}</span>
              {r.party && (
                <Link href={`/app/parties/${r.party.id}`} className="text-brand font-semibold hover:underline">
                  {r.party.displayName}
                </Link>
              )}
            </div>
            <span className="text-ink-muted">{displayDate(r.screeningDate)}</span>
          </div>
          <div className="flex items-center gap-4 text-ink-muted flex-wrap">
            <span>{r.hitCount} match(es)</span>
            <span>{r.redFlagCount} red flag(s)</span>
            {r.disposition && <Badge variant="neutral">{r.disposition.status.replace(/_/g, " ")}</Badge>}
          </div>
          {r.matches.length > 0 && (
            <div className="pt-2 border-t border-border space-y-1">
              {r.matches.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-ink-muted">
                  <span>{m.matchedName} <span className="text-[10px]">({m.sourceList})</span></span>
                  <span className="font-mono text-[10px]">{m.nameScore}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ScreeningPanel({ screeningBuckets, mayReadPartyScreening, partyScreeningResults }: ScreeningPanelProps) {
  const [activeSub, setActiveSub] = useState<SubTab>(mayReadPartyScreening ? "party" : "embargo");

  const selectSub = (tab: SubTab) => {
    setActiveSub(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("screeningTab", tab);
    window.history.replaceState(null, "", url);
  };

  const combined = (...cats: string[]) => cats.flatMap((c) => screeningBuckets[c]?.items ?? []);
  const openCount = (...cats: string[]) => cats.reduce((sum, c) => sum + (screeningBuckets[c]?.openCount ?? 0), 0);

  const partyOpenCount = partyScreeningResults.filter((r) => !r.disposition || r.disposition.status === "PENDING").length;

  const subTabs: { id: SubTab; label: string; count: number; hidden?: boolean }[] = [
    { id: "party", label: "Party Screening", count: partyOpenCount, hidden: !mayReadPartyScreening },
    { id: "embargo", label: "Country Embargo", count: openCount("COUNTRY_EMBARGO") },
    { id: "uflpa", label: "Forced Labor / UFLPA", count: openCount("UFLPA") },
    { id: "endUse", label: "End-Use / End-User", count: openCount("END_USE_RESTRICTION", "END_USER_RESTRICTION") },
    { id: "military", label: "Military End-Use / End-User", count: openCount("MILITARY_END_USE", "MILITARY_END_USER") },
    { id: "antiBoycott", label: "Anti-Boycott", count: openCount("ANTI_BOYCOTT") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {subTabs
            .filter((t) => !t.hidden)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectSub(t.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeSub === t.id ? "bg-ink text-white" : "bg-slate-50 text-ink-muted hover:text-ink border border-border"
                }`}
              >
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className={`rounded-full px-1.5 text-[10px] ${activeSub === t.id ? "bg-white/20" : "bg-slate-200"}`}>{t.count}</span>
                )}
              </button>
            ))}
        </div>
        {mayReadPartyScreening && activeSub === "party" && (
          <Link href="/app/compliance/screen">
            <Button variant="secondary" size="sm">
              New Screening
            </Button>
          </Link>
        )}
      </div>

      <div key={activeSub}>
        {activeSub === "party" && mayReadPartyScreening && <PartyScreeningList results={partyScreeningResults} />}
        {activeSub === "embargo" && <FindingsList items={combined("COUNTRY_EMBARGO")} />}
        {activeSub === "uflpa" && <FindingsList items={combined("UFLPA")} />}
        {activeSub === "endUse" && <FindingsList items={combined("END_USE_RESTRICTION", "END_USER_RESTRICTION")} />}
        {activeSub === "military" && <FindingsList items={combined("MILITARY_END_USE", "MILITARY_END_USER")} />}
        {activeSub === "antiBoycott" && <FindingsList items={combined("ANTI_BOYCOTT")} />}
      </div>
    </div>
  );
}
