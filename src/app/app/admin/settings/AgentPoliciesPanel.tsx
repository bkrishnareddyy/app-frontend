"use client";

import { useState } from "react";
import { Bot, ChevronDown, ChevronRight, History, Save } from "lucide-react";

interface AgentPolicy {
  id: string;
  agentName: string;
  autoThreshold: number;
  confirmThreshold: number;
  requirePartMasterMatch: boolean;
  updatedAt: string;
}

interface PolicyHistoryEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  changedBy: string;
  createdAt: string;
}

const KNOWN_AGENTS = [
  { key: "HTS_CLASSIFICATION", label: "HTS Classification" },
  { key: "ORIGIN_DETERMINATION", label: "Origin Determination" },
  { key: "VALUATION", label: "Valuation" },
  { key: "PARTY_SCREENING", label: "Party Screening" },
  { key: "DOCUMENT_EXTRACTION", label: "Document Extraction" },
];

interface AgentPoliciesPanelProps {
  initialPolicies: AgentPolicy[];
  history: PolicyHistoryEntry[];
}

export function AgentPoliciesPanel({ initialPolicies, history }: AgentPoliciesPanelProps) {
  const [policies, setPolicies] = useState<Record<string, AgentPolicy>>(
    Object.fromEntries(initialPolicies.map((p) => [p.agentName, p]))
  );
  const [drafts, setDrafts] = useState<Record<string, Partial<AgentPolicy>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const getDraft = (agentKey: string) => {
    const policy = policies[agentKey];
    const draft = drafts[agentKey] ?? {};
    return {
      autoThreshold: draft.autoThreshold ?? policy?.autoThreshold ?? 85,
      confirmThreshold: draft.confirmThreshold ?? policy?.confirmThreshold ?? 60,
      requirePartMasterMatch: draft.requirePartMasterMatch ?? policy?.requirePartMasterMatch ?? false,
    };
  };

  const updateDraft = (agentKey: string, field: string, value: unknown) => {
    setDrafts((prev) => ({
      ...prev,
      [agentKey]: { ...(prev[agentKey] ?? {}), [field]: value },
    }));
  };

  const savePolicy = async (agentKey: string) => {
    const draft = getDraft(agentKey);
    if (draft.autoThreshold <= draft.confirmThreshold) {
      setError("Auto-approval threshold must be greater than the confirm threshold.");
      return;
    }
    setSaving(agentKey);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/agent-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: agentKey, ...draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      const data = await res.json();
      setPolicies((prev) => ({ ...prev, [agentKey]: data.policy }));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[agentKey];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-brand" />
        <h2 className="text-base font-extrabold text-ink">AI Agent Policies</h2>
      </div>
      <p className="text-sm text-ink-muted">
        Configure confidence thresholds for auto-approval and confirmation. Decisions below the confirm
        threshold are always sent for human review.
      </p>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {KNOWN_AGENTS.map(({ key, label }) => {
          const draft = getDraft(key);
          const isDirty = !!drafts[key];

          return (
            <div
              key={key}
              className="bg-white border border-border rounded-2xl p-5 space-y-4 shadow-2xs"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-ink">{label}</p>
                  <p className="text-[11px] text-ink-muted font-mono">{key}</p>
                </div>
                {isDirty && (
                  <button
                    onClick={() => savePolicy(key)}
                    disabled={saving === key}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving === key ? "Saving…" : "Save"}
                  </button>
                )}
              </div>

              {/* Auto threshold */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">Auto-approval threshold</span>
                  <span className="font-bold text-emerald-700 tabular-nums">{draft.autoThreshold}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.autoThreshold}
                  onChange={(e) => updateDraft(key, "autoThreshold", Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <p className="text-[10px] text-ink-muted">
                  Decisions at or above this confidence are auto-approved without human review.
                </p>
              </div>

              {/* Confirm threshold */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">Confirm threshold</span>
                  <span className="font-bold text-amber-700 tabular-nums">{draft.confirmThreshold}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.confirmThreshold}
                  onChange={(e) => updateDraft(key, "confirmThreshold", Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <p className="text-[10px] text-ink-muted">
                  Between confirm and auto thresholds, decisions go to CONFIRM. Below confirm they go to REVIEW.
                </p>
              </div>

              {/* Threshold visualisation */}
              <div className="relative h-3 rounded-full bg-surface-muted overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full bg-red-300 rounded-l-full"
                  style={{ width: `${draft.confirmThreshold}%` }}
                />
                <div
                  className="absolute top-0 h-full bg-amber-300"
                  style={{
                    left: `${draft.confirmThreshold}%`,
                    width: `${draft.autoThreshold - draft.confirmThreshold}%`,
                  }}
                />
                <div
                  className="absolute top-0 h-full bg-emerald-400 rounded-r-full"
                  style={{ left: `${draft.autoThreshold}%`, width: `${100 - draft.autoThreshold}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-ink-muted font-semibold">
                <span>REVIEW (&lt;{draft.confirmThreshold}%)</span>
                <span>CONFIRM</span>
                <span>AUTO (&gt;{draft.autoThreshold}%)</span>
              </div>

              {/* Part master toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.requirePartMasterMatch}
                  onChange={(e) => updateDraft(key, "requirePartMasterMatch", e.target.checked)}
                  className="w-4 h-4 rounded border-border text-brand focus:ring-brand cursor-pointer"
                />
                <div>
                  <span className="text-xs font-semibold text-ink">Require part master match</span>
                  <p className="text-[10px] text-ink-muted">
                    Forces REVIEW even above the auto threshold when no part-master record is matched.
                  </p>
                </div>
              </label>
            </div>
          );
        })}
      </div>

      {/* Policy history */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-2xs">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-ink hover:bg-surface-muted/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-ink-muted" />
            Policy change history
          </div>
          {showHistory ? (
            <ChevronDown className="w-4 h-4 text-ink-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-ink-muted" />
          )}
        </button>

        {showHistory && (
          <div className="border-t border-border divide-y divide-border">
            {history.length === 0 ? (
              <p className="text-sm text-ink-muted px-5 py-4">No policy changes recorded yet.</p>
            ) : (
              history.slice(0, 20).map((h) => {
                const meta = h.metadata as Record<string, unknown>;
                return (
                  <div key={h.id} className="px-5 py-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{String(meta.agentName ?? "Unknown agent")}</span>
                      <span className="text-[10px] text-ink-muted">
                        {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-ink-muted mt-0.5">
                      Changed by <span className="font-medium text-ink">{h.changedBy}</span>
                      {meta.previousAutoThreshold !== undefined && (
                        <> — Auto: {String(meta.previousAutoThreshold)}% → {String(meta.autoThreshold)}%</>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
