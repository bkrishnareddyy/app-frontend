"use client";

import { Rocket } from "lucide-react";

interface DeploymentEntry {
  hash: string;
  date: string;
  summary: string;
  author: string;
}

function parseLog(): DeploymentEntry[] {
  try {
    const raw = process.env.NEXT_PUBLIC_DEPLOYMENT_LOG;
    if (!raw) return [];
    return JSON.parse(raw) as DeploymentEntry[];
  } catch {
    return [];
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DeploymentsPanel() {
  const entries = parseLog();
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const currentSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA?.slice(0, 7) ?? "—";

  return (
    <div className="space-y-6">
      {/* Current build banner */}
      <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <Rocket className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-xs text-ink-muted">Currently deployed build</p>
            <p className="font-mono text-sm font-bold text-emerald-800">{currentSha}</p>
          </div>
        </div>
        {buildTime && (
          <p className="text-xs text-ink-muted">{fmt(buildTime)}</p>
        )}
      </div>

      {/* Deployment history table */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-bold text-ink">Deployment History</h2>
          <p className="text-xs text-ink-muted mt-0.5">Last {entries.length} commits bundled into this build.</p>
        </div>

        {entries.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">No git history available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-ink">
              <thead className="bg-surface-muted border-b border-border text-xs uppercase font-bold text-ink-muted">
                <tr>
                  <th className="px-5 py-3 whitespace-nowrap">Commit</th>
                  <th className="px-5 py-3 whitespace-nowrap">When</th>
                  <th className="px-5 py-3">Summary</th>
                  <th className="px-5 py-3 whitespace-nowrap">Author</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((e, i) => (
                  <tr key={e.hash} className={`align-top hover:bg-slate-50 transition-colors ${i === 0 ? "bg-emerald-50/40" : ""}`}>
                    <td className="px-5 py-3 font-mono text-xs whitespace-nowrap text-ink-muted">
                      {i === 0 ? (
                        <span className="text-emerald-700 font-bold">{e.hash} ← current</span>
                      ) : e.hash}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-muted whitespace-nowrap">{fmt(e.date)}</td>
                    <td className="px-5 py-3 text-xs leading-snug">{e.summary}</td>
                    <td className="px-5 py-3 text-xs text-ink-muted whitespace-nowrap">{e.author}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
