"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ReceiptText,
  Plus,
  Clock,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  XCircle,
  FileCheck,
  RotateCcw,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { displayCurrency } from "@/lib/honest";

interface PscDeadline {
  dueAt: string | null;
}

interface PscRecord {
  id: string;
  correctionType: string;
  originalDutyAmount: number;
  correctedDutyAmount: number;
  dutyDelta: number | null;
  refundAmount: number;
  status: string;
  reason: string;
  legalBasis: string | null;
  filedAt: string | null;
  createdAt: string;
  originalFiling: {
    entryNumber: string;
    shipment: {
      shipmentNumber: string;
      complianceDeadlines: PscDeadline[];
    };
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  Draft: { label: "Draft", color: "bg-slate-100 text-slate-700", icon: ReceiptText },
  READY_FOR_REVIEW: { label: "Ready for Review", color: "bg-blue-100 text-blue-700", icon: FileCheck },
  SUBMITTED: { label: "Submitted", color: "bg-violet-100 text-violet-700", icon: FileCheck },
  ACE_ACCEPTED: { label: "ACE Accepted", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  ACE_REJECTED: { label: "ACE Rejected", color: "bg-red-100 text-red-700", icon: XCircle },
  WITHDRAWN: { label: "Withdrawn", color: "bg-zinc-100 text-zinc-500", icon: RotateCcw },
};

const CORRECTION_LABELS: Record<string, string> = {
  CLASSIFICATION_CORRECTION: "Classification",
  VALUE_CORRECTION: "Valuation",
  QUANTITY_CORRECTION: "Quantity",
  DUTY_RATE_CORRECTION: "Duty Rate",
};

function daysRemaining(dueAt: string | null): number | null {
  if (!dueAt) return null;
  return Math.max(0, Math.floor((new Date(dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function WindowBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-xs text-ink-muted">No window data</span>;
  if (days <= 7) return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
      <AlertTriangle className="w-3 h-3" /> {days}d left
    </span>
  );
  if (days <= 30) return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      <Clock className="w-3 h-3" /> {days}d left
    </span>
  );
  return <span className="text-xs text-ink-muted">{days}d left</span>;
}

export function PscListClient() {
  const [pscs, setPscs] = useState<PscRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (typeFilter !== "ALL") params.set("correctionType", typeFilter);
    fetch(`/api/refunds/psc?${params}`)
      .then((r) => r.json())
      .then((d) => setPscs(d.pscs ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const urgentCount = pscs.filter((p) => {
    const days = daysRemaining(p.originalFiling?.shipment?.complianceDeadlines?.[0]?.dueAt ?? null);
    return days !== null && days <= 7 && !["SUBMITTED", "ACE_ACCEPTED", "WITHDRAWN"].includes(p.status);
  }).length;

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <Link href="/app/post-entry" className="hover:text-brand transition-colors">Post-Entry</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">Post-Summary Corrections</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-400 flex items-center justify-center shadow-sm">
              <ReceiptText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink tracking-tight">Post-Summary Corrections</h1>
              <p className="text-sm text-ink-muted">
                Correct entry summaries before CBP liquidation within the 270-day window.
              </p>
            </div>
          </div>
          <Link
            href="/app/post-entry/psc/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold shadow-sm hover:bg-brand/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New PSC
          </Link>
        </div>
        {urgentCount > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {urgentCount} PSC{urgentCount > 1 ? "s" : ""} have windows closing within 7 days — review immediately.
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
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="ALL">All Types</option>
          {Object.entries(CORRECTION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <span className="text-xs text-ink-muted ml-auto">{pscs.length} record{pscs.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <div className="px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-ink-muted text-sm">Loading…</div>
        ) : pscs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ReceiptText className="w-10 h-10 text-ink-muted/40 mb-3" />
            <p className="text-ink font-medium">No PSCs found</p>
            <p className="text-sm text-ink-muted mt-1">
              Create a PSC to correct an entry summary before CBP liquidation.
            </p>
            <Link
              href="/app/post-entry/psc/new"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" /> New PSC
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50">
                  {["Entry #", "Shipment", "Type", "Original Duty", "Corrected Duty", "Delta", "Status", "Window", ""].map(
                    (h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pscs.map((psc) => {
                  const cfg = STATUS_CONFIG[psc.status] ?? STATUS_CONFIG["Draft"];
                  const Icon = cfg.icon;
                  const days = daysRemaining(
                    psc.originalFiling?.shipment?.complianceDeadlines?.[0]?.dueAt ?? null
                  );
                  const delta = psc.dutyDelta ?? (psc.correctedDutyAmount - psc.originalDutyAmount);
                  return (
                    <tr key={psc.id} className="hover:bg-surface-muted/40 transition-colors group">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-ink">
                        {psc.originalFiling?.entryNumber ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {psc.originalFiling?.shipment?.shipmentNumber ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-muted text-xs font-medium text-ink">
                          {CORRECTION_LABELS[psc.correctionType] ?? psc.correctionType}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{displayCurrency(psc.originalDutyAmount)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{displayCurrency(psc.correctedDutyAmount)}</td>
                      <td className={cn("px-4 py-3 font-mono text-xs font-semibold",
                        delta > 0 ? "text-red-600" : delta < 0 ? "text-emerald-600" : "text-ink-muted"
                      )}>
                        {delta > 0 ? `+${displayCurrency(delta)}` : delta < 0 ? displayCurrency(delta) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", cfg.color)}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <WindowBadge days={days} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/post-entry/psc/${psc.id}`}
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
