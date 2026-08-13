"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Clock, AlertTriangle, CheckCircle2, User, ChevronDown } from "lucide-react";
import { RESOLUTION_REASONS, reasonsForCategory, type ExceptionCategory } from "@/modules/exceptions/resolutionReasons";

interface HistoryEntry {
  timestamp: string;
  userId: string;
  action: string;
  note?: string;
}

interface ExceptionDetail {
  id: string;
  type: string;
  category: string | null;
  severity: string;
  description: string;
  status: string;
  requiredAction: string | null;
  blocking: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  assignedToUserId: string | null;
  assignedToUser: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  version: number;
  history: HistoryEntry[];
}

interface TeamMember {
  id: string;
  name: string;
}

interface ExceptionSlideOverProps {
  exceptionId: string;
  shipmentId: string | undefined;
  canWrite: boolean;
  canWaive: boolean;
  teamMembers?: TeamMember[];
  onResolved: () => void;
  onClose: () => void;
}

const SEVERITY_CLASSES: Record<string, string> = {
  Critical: "bg-red-100 text-red-800 border-red-200",
  High: "bg-amber-100 text-amber-800 border-amber-200",
  Medium: "bg-yellow-50 text-yellow-800 border-yellow-200",
  Low: "bg-gray-100 text-gray-600 border-gray-200",
};

function formatAction(action: string): string {
  if (action.startsWith("status_changed:")) return `Status → ${action.replace("status_changed:", "").replace(/_/g, " ")}`;
  if (action.startsWith("assigned:")) {
    const to = action.replace("assigned:", "");
    return to === "unassigned" ? "Unassigned" : `Assigned to user ${to.slice(0, 8)}…`;
  }
  return action;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export function ExceptionSlideOver({
  exceptionId,
  canWrite,
  canWaive,
  teamMembers = [],
  onResolved,
  onClose,
}: ExceptionSlideOverProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<null | "resolve" | "waive" | "assign">(null);
  const [reasonNote, setReasonNote] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      fetch(`/api/exceptions/${encodeURIComponent(exceptionId)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setDetail(data.exception ?? data);
        })
        .catch(() => {
          if (!cancelled) setError("Failed to load exception details.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [exceptionId]);

  const submit = async () => {
    if (!detail) return;
    if (mode === "resolve" && !reasonNote.trim()) {
      setSubmitError("A resolution note is required.");
      return;
    }
    if (mode === "waive") {
      if (!reasonNote.trim()) { setSubmitError("A resolution note is required."); return; }
      if (!reasonCode) { setSubmitError("A reason code is required to waive."); return; }
    }
    if (mode === "assign" && !assigneeId) {
      setSubmitError("Select a team member.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = { expectedVersion: detail.version };
      if (mode === "resolve") {
        body.status = "RESOLVED";
        body.resolutionReason = reasonNote.trim();
        if (reasonCode) body.resolutionReasonCode = reasonCode;
      } else if (mode === "waive") {
        body.status = "WAIVED";
        body.resolutionReason = reasonNote.trim();
        body.resolutionReasonCode = reasonCode;
      } else if (mode === "assign") {
        body.assignedToUserId = assigneeId;
      }

      const res = await fetch(`/api/exceptions/${encodeURIComponent(exceptionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? "This exception changed while you were working. Reload to see the latest."
            : data?.error?.message || data?.error || "Update failed."
        );
      }

      if (mode === "resolve" || mode === "waive") {
        onResolved();
      } else {
        setDetail(data.exception ?? data);
        setMode(null);
        setAssigneeId("");
      }
      router.refresh();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const category = (detail?.category ?? null) as ExceptionCategory | null;
  const resolveReasons = reasonsForCategory(category).filter((r) => !r.isRiskAcceptance);
  const waiveReasons = RESOLUTION_REASONS.filter((r) => r.isRiskAcceptance);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/30 cursor-default"
        onClick={onClose}
        aria-label="Close"
      />
      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold text-ink">Exception Details</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-muted transition-colors">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="text-xs text-ink-muted py-8 text-center">Loading…</div>
          )}
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>
          )}
          {detail && !loading && (
            <>
              {/* Title & severity */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEVERITY_CLASSES[detail.severity] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                    {detail.severity}
                  </span>
                  {detail.blocking && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Filing Blocker
                    </span>
                  )}
                  <span className="text-[10px] text-ink-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo(detail.createdAt)}
                  </span>
                </div>
                <h3 className="text-base font-bold text-ink">
                  {detail.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </h3>
                {detail.category && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    {detail.category.replace(/_/g, " ")}
                  </span>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Description</p>
                <p className="text-xs text-ink leading-relaxed">{detail.description}</p>
              </div>

              {/* Required action */}
              {detail.requiredAction && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Action Required</p>
                  <p className="text-xs text-amber-900">{detail.requiredAction}</p>
                </div>
              )}

              {/* Assigned to */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Assigned To</p>
                {detail.assignedToUser ? (
                  <div className="flex items-center gap-2 text-xs text-ink">
                    <div className="w-5 h-5 rounded-full bg-brand/10 flex items-center justify-center">
                      <User className="w-3 h-3 text-brand" />
                    </div>
                    {[detail.assignedToUser.firstName, detail.assignedToUser.lastName].filter(Boolean).join(" ") || detail.assignedToUser.email}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">Unassigned</p>
                )}
              </div>

              {/* Status */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Status</p>
                <p className="text-xs font-semibold text-ink">{detail.status.replace(/_/g, " ")}</p>
              </div>

              {/* History */}
              {detail.history.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">History</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {[...detail.history].reverse().map((entry, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-brand/40 mt-1.5 shrink-0" />
                        <div>
                          <span className="font-medium text-ink">{formatAction(entry.action)}</span>
                          {entry.note && <span className="text-ink-muted ml-1">— {entry.note}</span>}
                          <span className="text-ink-muted text-[10px] ml-2">{timeAgo(entry.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resolution actions */}
              {canWrite && detail.status !== "RESOLVED" && detail.status !== "WAIVED" && (
                <div className="space-y-3 border-t border-border pt-4">
                  {submitError && (
                    <p role="alert" className="text-xs text-red-700">{submitError}</p>
                  )}
                  {mode === null && (
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => { setMode("resolve"); setReasonCode(""); setReasonNote(""); }}
                        className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink hover:border-emerald-500 hover:text-emerald-700 transition-colors"
                      >
                        Resolve
                      </button>
                      {canWaive && (
                        <button
                          onClick={() => { setMode("waive"); setReasonCode(""); setReasonNote(""); }}
                          className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink hover:border-amber-400 hover:text-amber-700 transition-colors"
                        >
                          Waive
                        </button>
                      )}
                      {teamMembers.length > 0 && (
                        <button
                          onClick={() => { setMode("assign"); setAssigneeId(""); }}
                          className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-ink hover:border-brand hover:text-brand transition-colors"
                        >
                          Assign
                        </button>
                      )}
                    </div>
                  )}

                  {(mode === "resolve" || mode === "waive") && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-ink">
                        {mode === "waive" ? "Waive — accept risk" : "Resolve — problem fixed"}
                      </p>

                      {/* Reason code picklist */}
                      <div className="relative">
                        <select
                          value={reasonCode}
                          onChange={(e) => setReasonCode(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-border text-xs text-ink focus:outline-none focus:border-brand appearance-none bg-white pr-8"
                        >
                          <option value="">Select reason code{mode === "waive" ? " (required)" : " (optional)"}…</option>
                          {(mode === "waive" ? waiveReasons : resolveReasons).map((r) => (
                            <option key={r.code} value={r.code}>{r.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-ink-muted absolute right-3 top-2.5 pointer-events-none" />
                      </div>

                      <textarea
                        autoFocus
                        rows={3}
                        value={reasonNote}
                        onChange={(e) => setReasonNote(e.target.value)}
                        placeholder={mode === "waive" ? "Why is this risk being accepted? (required)" : "What was done to resolve this? (required)"}
                        className="w-full px-3 py-2 rounded-xl border border-border text-xs text-ink resize-none focus:outline-none focus:border-brand"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={submit}
                          disabled={submitting}
                          className="px-4 py-2 rounded-xl bg-ink text-white text-xs font-semibold disabled:opacity-50 hover:bg-ink/80 transition-colors"
                        >
                          {submitting ? "Saving…" : mode === "waive" ? "Confirm Waive" : "Confirm Resolve"}
                        </button>
                        <button
                          onClick={() => { setMode(null); setSubmitError(null); }}
                          className="text-xs text-ink-muted hover:text-ink font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {mode === "assign" && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-ink">Assign to team member</p>
                      <div className="relative">
                        <select
                          value={assigneeId}
                          onChange={(e) => setAssigneeId(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-border text-xs text-ink focus:outline-none focus:border-brand appearance-none bg-white pr-8"
                        >
                          <option value="">Select team member…</option>
                          <option value="">— Unassign —</option>
                          {teamMembers.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-ink-muted absolute right-3 top-2.5 pointer-events-none" />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={submit}
                          disabled={submitting}
                          className="px-4 py-2 rounded-xl bg-ink text-white text-xs font-semibold disabled:opacity-50 hover:bg-ink/80 transition-colors"
                        >
                          {submitting ? "Assigning…" : "Assign"}
                        </button>
                        <button
                          onClick={() => { setMode(null); setSubmitError(null); }}
                          className="text-xs text-ink-muted hover:text-ink font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Resolved state */}
              {(detail.status === "RESOLVED" || detail.status === "WAIVED") && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    {detail.status === "WAIVED" ? "Waived" : "Resolved"}
                    {detail.resolvedByName ? ` by ${detail.resolvedByName}` : ""}
                    {detail.resolutionNote ? ` — ${detail.resolutionNote}` : ""}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
