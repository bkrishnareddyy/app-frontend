"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Scale,
  Plus,
  Clock,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  XCircle,
  FileCheck,
  RotateCcw,
  Filter,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { displayCurrency } from "@/lib/honest";

interface ProtestRecord {
  id: string;
  groundsCode: string;
  groundsNarrative: string;
  claimAmount: number;
  status: string;
  liquidationDate: string;
  protestDeadline: string;
  deemedDeniedAt: string | null;
  furtherReviewRequested: boolean;
  powerOfAttorneyVerified: boolean;
  protestEntries: Array<{
    id: string;
    entryNumber: string;
    dutyContested: number;
  }>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  DRAFT: { label: "Draft", color: "bg-slate-100 text-slate-700", icon: Scale },
  READY_FOR_FILING: { label: "Ready for Filing", color: "bg-blue-100 text-blue-700", icon: FileCheck },
  FILED: { label: "Filed with CBP", color: "bg-violet-100 text-violet-700", icon: FileCheck },
  FURTHER_REVIEW_REQUESTED: { label: "FRP Requested", color: "bg-amber-100 text-amber-800", icon: ShieldCheck },
  APPROVED: { label: "Approved / Granted", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  DENIED: { label: "Denied", color: "bg-red-100 text-red-700", icon: XCircle },
  DEEMED_DENIED: { label: "Deemed Denied (2yr)", color: "bg-red-100 text-red-800", icon: Clock },
  WITHDRAWN: { label: "Withdrawn", color: "bg-zinc-100 text-zinc-500", icon: RotateCcw },
};

const GROUNDS_LABELS: Record<string, string> = {
  CLASSIFICATION: "Classification",
  VALUATION: "Valuation",
  ORIGIN: "Country of Origin",
  RATE_OF_DUTY: "Rate of Duty",
  LIQUIDATION_ERRORS: "Liquidation Error",
  EXCLUSION_ELIGIBILITY: "Exclusion Claim",
  DRAWBACK_DENIAL: "Drawback Denial",
  OTHER: "Other Legal Grounds",
};

function daysRemaining(deadlineIso: string): number {
  return Math.max(0, Math.floor((new Date(deadlineIso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function WindowBadge({ days, label = "days left" }: { days: number; label?: string }) {
  if (days <= 7) return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
      <AlertTriangle className="w-3 h-3" /> {days} {label}
    </span>
  );
  if (days <= 30) return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      <Clock className="w-3 h-3" /> {days} {label}
    </span>
  );
  return <span className="text-xs text-ink-muted">{days} {label}</span>;
}

export function ProtestListClient() {
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [groundsFilter, setGroundsFilter] = useState("ALL");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (groundsFilter !== "ALL") params.set("groundsCode", groundsFilter);

    fetch(`/api/protests?${params}`)
      .then((r) => r.json())
      .then((d) => setProtests(d.protests ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter, groundsFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const urgentCount = protests.filter((p) => {
    const days = daysRemaining(p.protestDeadline);
    return days <= 30 && !["FILED", "APPROVED", "DENIED", "DEEMED_DENIED", "WITHDRAWN"].includes(p.status);
  }).length;

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <Link href="/app/post-entry" className="hover:text-brand transition-colors">Post-Entry</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">Protests (CBP Form 19)</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-sm">
              <Scale className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink tracking-tight">Protests (CBP Form 19)</h1>
              <p className="text-sm text-ink-muted">
                Challenge CBP liquidation decisions under 19 U.S.C. § 1514 within the 180-day window.
              </p>
            </div>
          </div>
          <Link
            href="/app/post-entry/protests/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold shadow-sm hover:bg-brand/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            File New Protest
          </Link>
        </div>

        {urgentCount > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            {urgentCount} protest{urgentCount > 1 ? "s" : ""} have statutory 180-day deadlines within 30 days.
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="px-6 py-3 bg-white/50 border-b border-border flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-ink-muted" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="ALL">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          value={groundsFilter}
          onChange={(e) => setGroundsFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="ALL">All Grounds</option>
          {Object.entries(GROUNDS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <span className="text-xs text-ink-muted ml-auto">{protests.length} protest record{protests.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <div className="px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-ink-muted text-sm">Loading protests…</div>
        ) : protests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Scale className="w-10 h-10 text-ink-muted/40 mb-3" />
            <p className="text-ink font-medium">No Protests recorded</p>
            <p className="text-sm text-ink-muted mt-1 max-w-sm">
              File a Form 19 protest to contest CBP decisions on liquidated entry summaries.
            </p>
            <Link
              href="/app/post-entry/protests/new"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" /> File New Protest
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50">
                  {["Protest ID / Entries", "Grounds", "Contested Claim", "Status", "POA", "Filing Window", ""].map(
                    (h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {protests.map((p) => {
                  const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG["DRAFT"];
                  const Icon = cfg.icon;
                  const days = daysRemaining(p.protestDeadline);
                  const entryNumbers = p.protestEntries.map((e) => e.entryNumber).join(", ") || "No entries attached";

                  return (
                    <tr key={p.id} className="hover:bg-surface-muted/40 transition-colors group">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-ink">#{p.id.slice(-6).toUpperCase()}</p>
                        <p className="text-xs text-ink-muted truncate max-w-xs">{entryNumbers}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-800">
                          {GROUNDS_LABELS[p.groundsCode] ?? p.groundsCode}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-ink">
                        {displayCurrency(p.claimAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", cfg.color)}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.powerOfAttorneyVerified ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                            <ShieldCheck className="w-3.5 h-3.5" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" /> Unverified
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <WindowBadge days={days} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/post-entry/protests/${p.id}`}
                          className="inline-flex items-center gap-1 text-xs text-brand font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          View <ChevronRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
