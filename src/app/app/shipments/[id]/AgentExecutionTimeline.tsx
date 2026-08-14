"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, Sparkles, XCircle } from "lucide-react";
import type { AgentInvocation } from "./agentInvocations";

function parseErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    // Gemini-style: { error: { message, code, status } }
    if (parsed?.error?.message) return `[${parsed.error.code ?? parsed.error.status}] ${parsed.error.message}`;
    // Flat { message } shape
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // not JSON — use as-is
  }
  return raw;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<AgentInvocation["status"], { badge: string; label: string; icon: React.ReactNode }> = {
  COMPLETED: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Completed",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  FAILED: {
    badge: "bg-red-50 text-red-700 border-red-200",
    label: "Failed",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  REVIEW: {
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Review Required",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  RUNNING: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    label: "Running",
    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  },
};

// Poll every 3s while a run is active, 30s otherwise (cheap keep-alive to catch
// new runs that start while the tab is open).
const POLL_INTERVAL_ACTIVE_MS = 3000;
const POLL_INTERVAL_IDLE_MS = 30000;

export function AgentExecutionTimeline({
  invocations: initialInvocations,
  shipmentId,
}: {
  invocations: AgentInvocation[];
  shipmentId: string;
}) {
  const [invocations, setInvocations] = useState<AgentInvocation[]>(initialInvocations);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(initialInvocations[0]?.runId || null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // Sync if the server re-renders with fresh props (e.g. router.refresh() after
  // pipeline completes). Adjusted directly during render, per React's
  // documented pattern for deriving state from a changed prop, rather than in
  // an effect (which would cause an extra render).
  const [prevInitialInvocations, setPrevInitialInvocations] = useState(initialInvocations);
  if (initialInvocations !== prevInitialInvocations) {
    setPrevInitialInvocations(initialInvocations);
    setInvocations(initialInvocations);
  }

  useEffect(() => {
    cancelledRef.current = false;

    const poll = async () => {
      // Skip the network round-trip while the tab is backgrounded; the
      // visibilitychange listener below catches up as soon as it's visible.
      if (document.visibilityState !== "visible") {
        timerRef.current = setTimeout(poll, POLL_INTERVAL_IDLE_MS);
        return;
      }

      try {
        const res = await fetch(`/api/shipments/${shipmentId}/agent-executions`);
        if (cancelledRef.current) return;
        if (res.ok) {
          const data: { invocations: AgentInvocation[] } = await res.json();
          if (cancelledRef.current) return;
          setInvocations((prev) => {
            // Auto-expand the newest run if it is brand-new.
            const newestRunId = data.invocations[0]?.runId;
            if (newestRunId && !prev.some((i) => i.runId === newestRunId)) {
              setExpandedRunId(newestRunId);
            }
            return data.invocations;
          });
        }
      } catch {
        // network error — keep polling
      }

      if (cancelledRef.current) return;

      // Determine next interval based on whether any run is still active.
      setInvocations((current) => {
        const hasActive = current.some((i) => i.status === "RUNNING");
        timerRef.current = setTimeout(poll, hasActive ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS);
        return current;
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timerRef.current) clearTimeout(timerRef.current);
      poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Start immediately so we catch runs that began right as the page loaded.
    poll();

    return () => {
      cancelledRef.current = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [shipmentId]);

  if (invocations.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-ink-muted text-xs">
        No agent runs recorded yet. Upload a document or edit a field to trigger the agent pipeline.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {invocations.map((inv) => {
        const isExpanded = expandedRunId === inv.runId;
        const style = STATUS_STYLES[inv.status];
        const waterfallSpan = Math.max(inv.totalDurationMs, 1);

        return (
          <div key={inv.runId} className="rounded-2xl border border-border bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedRunId(isExpanded ? null : inv.runId)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-muted transition-colors text-left"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <Sparkles className="w-4 h-4 text-brand shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink truncate">{inv.invokedBy}</p>
                  <p className="text-[10px] text-ink-muted font-medium flex items-center space-x-1.5 mt-0.5">
                    <Clock className="w-3 h-3" />
                    <span>{formatTimestamp(inv.startedAt)}</span>
                    <span>&middot;</span>
                    <span>{inv.steps.length} agent{inv.steps.length !== 1 ? "s" : ""}</span>
                    <span>&middot;</span>
                    <span>{formatDuration(inv.totalDurationMs)} total</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3 shrink-0 ml-3">
                <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase border ${style.badge}`}>
                  {style.icon}
                  <span>{style.label}</span>
                </span>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-ink-muted" /> : <ChevronDown className="w-4 h-4 text-ink-muted" />}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border bg-[#FAFAFC] px-4 py-4 space-y-2.5">
                {inv.steps.map((step, idx) => {
                  const stepStyle = STATUS_STYLES[step.status];
                  const offsetMs = new Date(step.startedAt).getTime() - new Date(inv.startedAt).getTime();
                  const offsetPct = Math.max(0, Math.min(100, (offsetMs / waterfallSpan) * 100));
                  const widthPct = Math.max(1.5, Math.min(100 - offsetPct, (step.durationMs / waterfallSpan) * 100));

                  return (
                    <div key={step.id} className="flex items-center space-x-3">
                      <span className="w-5 h-5 rounded-full bg-white border border-border text-[10px] font-bold text-ink inline-flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-[200px] max-w-[200px] shrink-0">
                        <p className="text-[11px] font-bold text-ink truncate" title={step.agentName}>
                          {step.agentName}
                        </p>
                        {step.summary && (
                          <p className="text-[9px] text-ink-muted truncate" title={step.summary}>
                            {step.summary}
                          </p>
                        )}
                        {step.modelVersion && (
                          <p className="text-[9px] text-ink-muted/60 truncate font-mono">
                            {step.modelVersion}
                          </p>
                        )}
                      </div>
                      <div className="flex-1 h-4 relative bg-[#F0F0F3] rounded-full overflow-hidden">
                        <div
                          className={`absolute top-0 bottom-0 rounded-full ${
                            step.status === "FAILED"
                              ? "bg-red-400"
                              : step.status === "REVIEW"
                              ? "bg-amber-400"
                              : step.status === "RUNNING"
                              ? "bg-blue-400"
                              : "bg-emerald-400"
                          }`}
                          style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                          title={`${formatDuration(step.durationMs)}`}
                        />
                      </div>
                      {step.confidence != null && (
                        <span className="text-[10px] font-mono font-bold text-ink-muted w-10 text-right shrink-0" title="Confidence">
                          {Math.round(Number(step.confidence))}%
                        </span>
                      )}
                      <span className="text-[10px] font-mono font-bold text-ink w-14 text-right shrink-0">
                        {formatDuration(step.durationMs)}
                      </span>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase border ${stepStyle.badge}`}>
                        {stepStyle.label}
                      </span>
                    </div>
                  );
                })}
                {inv.steps.some((s) => s.error) && (
                  <div className="pt-2 space-y-1">
                    {inv.steps
                      .filter((s) => s.error)
                      .map((s) => (
                        <p key={s.id} className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                          <span className="font-bold">{s.agentName}:</span>{" "}
                          {parseErrorMessage(s.error!)}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
