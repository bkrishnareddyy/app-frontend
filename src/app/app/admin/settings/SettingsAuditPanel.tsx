import { Settings, ShieldCheck, History, Key, CheckCircle2 } from "lucide-react";
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

      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
            <History className="w-5 h-5 text-indigo-600" />
            <span>Administrative Audit Log Trail</span>
          </h2>
          <Badge variant="neutral" className="font-mono normal-case">
            {auditLogs.length} Events Recorded
          </Badge>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">
            No administrative actions recorded yet for this account.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {auditLogs.map((log) => (
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
        )}
      </div>
    </div>
  );
}
