"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, Sparkles, XCircle } from "lucide-react";
import type { AgentInvocation } from "./agentInvocations";

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

export function AgentExecutionTimeline({ invocations }: { invocations: AgentInvocation[] }) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(invocations[0]?.runId || null);

  if (invocations.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[#86868B] text-xs">
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
          <div key={inv.runId} className="rounded-2xl border border-[#E5E5EA] bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedRunId(isExpanded ? null : inv.runId)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-[#F5F5F7] transition-colors text-left"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <Sparkles className="w-4 h-4 text-[#0071E3] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1D1D1F] truncate">{inv.invokedBy}</p>
                  <p className="text-[10px] text-[#86868B] font-medium flex items-center space-x-1.5 mt-0.5">
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
                {isExpanded ? <ChevronUp className="w-4 h-4 text-[#86868B]" /> : <ChevronDown className="w-4 h-4 text-[#86868B]" />}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-[#E5E5EA] bg-[#FAFAFC] px-4 py-4 space-y-2.5">
                {inv.steps.map((step, idx) => {
                  const stepStyle = STATUS_STYLES[step.status];
                  const offsetMs = new Date(step.startedAt).getTime() - new Date(inv.startedAt).getTime();
                  const offsetPct = Math.max(0, Math.min(100, (offsetMs / waterfallSpan) * 100));
                  const widthPct = Math.max(1.5, Math.min(100 - offsetPct, (step.durationMs / waterfallSpan) * 100));

                  return (
                    <div key={step.id} className="flex items-center space-x-3">
                      <span className="w-5 h-5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-bold text-[#1D1D1F] inline-flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-[190px] max-w-[190px] shrink-0">
                        <p className="text-[11px] font-bold text-[#1D1D1F] truncate" title={step.agentName}>
                          {step.agentName}
                        </p>
                        {step.summary && (
                          <p className="text-[9px] text-[#86868B] truncate" title={step.summary}>
                            {step.summary}
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
                      <span className="text-[10px] font-mono font-bold text-[#1D1D1F] w-14 text-right shrink-0">
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
                          <span className="font-bold">{s.agentName}:</span> {s.error}
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
