import { Settings, ShieldCheck, History, Key, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { PanelHeading } from "@/components/PanelHeading";
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
      <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
          <ShieldCheck className="w-5 h-5 text-[#0071E3]" />
          <span>Active Security Configuration</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-[#F5F5F7] border border-[#E5E5EA] rounded-2xl space-y-1">
            <span className="text-xs font-bold text-[#86868B] uppercase tracking-wider">Authentication Provider</span>
            <p className="text-sm font-bold text-[#1D1D1F] flex items-center space-x-2">
              <Key className="w-4 h-4 text-emerald-600" />
              <span>Clerk Identity Verification</span>
            </p>
          </div>

          <div className="p-4 bg-[#F5F5F7] border border-[#E5E5EA] rounded-2xl space-y-1">
            <span className="text-xs font-bold text-[#86868B] uppercase tracking-wider">Multi-Tenant Account Scope</span>
            <p className="text-sm font-bold text-[#1D1D1F] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-[#0071E3]" />
              <span>PostgreSQL Account Isolation (`accountId`)</span>
            </p>
          </div>
        </div>
      </div>
      )}

      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA] flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
            <History className="w-5 h-5 text-indigo-600" />
            <span>Administrative Audit Log Trail</span>
          </h2>
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-[#F5F5F7] text-[#86868B] border border-[#E5E5EA] font-semibold">
            {auditLogs.length} Events Recorded
          </span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-8 text-center text-[#86868B] text-sm">
            No administrative actions recorded yet for this account.
          </div>
        ) : (
          <div className="divide-y divide-[#E5E5EA]">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-50 transition-colors flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-[#0071E3] border border-blue-100">
                      {log.action}
                    </span>
                    <span className="text-xs text-[#1D1D1F] font-bold">{log.entity}</span>
                    <span className="text-xs text-[#86868B] font-mono">({log.entityId})</span>
                  </div>
                  {log.metadata != null && (
                    <pre className="text-[11px] font-mono text-[#1D1D1F] bg-[#F5F5F7] p-2.5 rounded-xl border border-[#E5E5EA] overflow-x-auto max-w-xl">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="text-right text-[11px] text-[#86868B] whitespace-nowrap">
                  <div>{formatDate(log.createdAt)}</div>
                  <div className="text-[#1D1D1F] font-medium">{log.userEmail || "System/Admin"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
