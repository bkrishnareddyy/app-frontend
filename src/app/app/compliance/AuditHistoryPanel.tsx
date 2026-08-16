"use client";

import { Clock } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { displayDate } from "@/lib/honest";

export interface AuditRecordProps {
  id: string;
  auditType: string;
  overallResult: string;
  riskScore: number | null;
  runAt: string;
  runByAgentName: string | null;
  entryNumber: string | null;
}

function resultBadge(result: string): BadgeProps["variant"] {
  if (result === "Pass") return "success";
  if (result === "Fail") return "danger";
  return "neutral";
}

export function AuditHistoryPanel({ recentAudits }: { recentAudits: AuditRecordProps[] }) {
  if (recentAudits.length === 0) {
    return (
      <Card className="text-center py-12 space-y-2">
        <Clock className="w-10 h-10 text-ink-muted mx-auto" />
        <p className="text-sm font-bold text-ink">No audit runs recorded yet</p>
        <p className="text-xs text-ink-muted">Run a compliance audit from the Review Queue tab to populate this history.</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-brand" />
        <span>Audit History</span>
      </h3>
      <div className="space-y-2 text-xs">
        {recentAudits.map((a) => (
          <div key={a.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={resultBadge(a.overallResult)}>{a.overallResult}</Badge>
              <span className="font-medium text-ink">{a.auditType}</span>
              {a.entryNumber && <span className="text-ink-muted">Entry {a.entryNumber}</span>}
              {a.riskScore !== null && <span className="text-ink-muted">Risk {a.riskScore}</span>}
              {a.runByAgentName && <span className="text-ink-muted">by {a.runByAgentName}</span>}
            </div>
            <span className="text-ink-muted">{displayDate(a.runAt)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
