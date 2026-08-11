"use client";

import { Rocket, Tag } from "lucide-react";
import { RELEASE_LOG, CURRENT_RELEASE } from "@/lib/version/releaseLog";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const runtimeCommit = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA?.slice(0, 7);
const displayCommit = runtimeCommit && runtimeCommit !== "unknown" ? runtimeCommit : CURRENT_RELEASE.commit;

export function DeploymentsPanel() {
  const rows = RELEASE_LOG.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Current deployment */}
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm">
        <h2 className="text-lg font-bold text-ink mb-1 flex items-center space-x-2">
          <Rocket className="w-5 h-5 text-emerald-600" />
          <span>Currently Deployed</span>
        </h2>
        <p className="text-xs text-ink-muted mb-4">The build currently running in this environment.</p>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <div className="flex items-center space-x-2">
            <Tag className="w-4 h-4 text-emerald-700" />
            <span className="text-sm font-mono font-bold text-emerald-800">
              v{CURRENT_RELEASE.version} · {displayCommit}
            </span>
          </div>
          <span className="text-xs text-emerald-700">{formatDateTime(CURRENT_RELEASE.date)}</span>
        </div>
        <p className="text-sm text-ink mt-3 leading-snug">
          {CURRENT_RELEASE.summary[0]}
          <br />
          {CURRENT_RELEASE.summary[1]}
        </p>
      </div>

      {/* Deployment history table */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
            <Rocket className="w-5 h-5 text-amber-600" />
            <span>Deployment History</span>
          </h2>
          <p className="text-xs text-ink-muted mt-0.5">Last {rows.length} rollouts, most recent first.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-surface-muted border-b border-border text-xs uppercase font-bold text-ink-muted">
              <tr>
                <th className="px-6 py-4">Version / Commit</th>
                <th className="px-6 py-4">Rolled Out</th>
                <th className="px-6 py-4">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((entry, idx) => (
                <tr key={`${entry.commit}-${idx}`} className="hover:bg-slate-50 transition-colors align-top">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge
                      className={cn(
                        "font-mono normal-case text-xs",
                        idx === 0
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-surface-muted text-ink border-border"
                      )}
                    >
                      v{entry.version} · {idx === 0 ? displayCommit : entry.commit}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-xs text-ink-muted whitespace-nowrap">
                    {formatDateTime(entry.date)}
                  </td>
                  <td className="px-6 py-4 text-xs text-ink leading-snug">
                    {entry.summary[0]}
                    <br />
                    {entry.summary[1]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
