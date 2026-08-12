"use client";

import { useState, useMemo } from "react";
import { Settings, ShieldCheck, History, Key, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { PanelHeading } from "@/components/PanelHeading";
import { Badge } from "@/components/ui/Badge";
import type { FormattedAuditLog } from "@/lib/admin/auditData";

interface SettingsAuditPanelProps {
  accountName: string;
  auditLogs: FormattedAuditLog[];
  compact?: boolean;
}

export function SettingsAuditPanel({ accountName, auditLogs, compact }: SettingsAuditPanelProps) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const total = auditLogs.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);

  const pagedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return auditLogs.slice(start, start + pageSize);
  }, [auditLogs, currentPage, pageSize]);

  const firstRow = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = Math.min(total, currentPage * pageSize);

  return (
    <div className={compact ? "space-y-5" : "space-y-8 max-w-5xl mx-auto"}>
      <PanelHeading
        icon={Settings}
        badge="Security & Governance"
        title="Account Audit Logs & Settings"
        subtitle={`Security settings and administrative audit history for ${accountName}.`}
        compact={compact}
      />

      {!compact && (
        <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-brand" />
            <span>Active Security Configuration</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-surface-muted border border-border rounded-2xl space-y-1">
              <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">Authentication Provider</span>
              <p className="text-sm font-bold text-ink flex items-center space-x-2">
                <Key className="w-4 h-4 text-emerald-600" />
                <span>Clerk Identity Verification</span>
              </p>
            </div>

            <div className="p-4 bg-surface-muted border border-border rounded-2xl space-y-1">
              <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">Multi-Tenant Account Scope</span>
              <p className="text-sm font-bold text-ink flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-brand" />
                <span>PostgreSQL Account Isolation (`accountId`)</span>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden space-y-0">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
            <History className="w-5 h-5 text-indigo-600" />
            <span>Administrative Audit Log Trail</span>
          </h2>
          <Badge variant="neutral" className="font-mono normal-case">
            {total} Events Recorded
          </Badge>
        </div>

        {total === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">
            No administrative actions recorded yet for this account.
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {pagedLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-slate-50 transition-colors flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Badge variant="info" className="font-mono">
                        {log.action}
                      </Badge>
                      <span className="text-xs text-ink font-bold">{log.entity}</span>
                      <span className="text-xs text-ink-muted font-mono">({log.entityId})</span>
                    </div>
                    {log.metadata != null && (
                      <pre className="text-[11px] font-mono text-ink bg-surface-muted p-2.5 rounded-xl border border-border overflow-x-auto max-w-xl">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-ink-muted whitespace-nowrap">
                    <div>{formatDate(log.createdAt)}</div>
                    <div className="text-ink font-medium">{log.userEmail || "System/Admin"}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Audit Logs Pagination Controls */}
            <div className="p-4 border-t border-border bg-surface-muted/30 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <p className="text-xs text-ink-muted">
                  Showing {firstRow}–{lastRow} of {total} events
                </p>
                <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <span>Rows</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    aria-label="Rows per page"
                    className="rounded-lg border border-border bg-white px-2 py-1 text-xs font-semibold text-ink focus:outline-none focus:border-brand cursor-pointer"
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">
                  Page {currentPage} of {pages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:bg-surface-muted disabled:text-ink-muted disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Previous</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-ink hover:bg-surface-muted disabled:bg-surface-muted disabled:text-ink-muted disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
