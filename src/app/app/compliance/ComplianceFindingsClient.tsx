"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronDown, ChevronUp, Download } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { displayDate } from "@/lib/honest";

type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface FindingProps {
  id: string;
  filingId: string;
  rule: string;
  severity: FindingSeverity;
  description: string;
  recommendation: string | null;
  status: string;
  confidence: number | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  filing: {
    id: string;
    entryNumber: string;
    filingStatus: string;
    shipmentNumber: string;
    importerName: string;
  } | null;
}

interface AuditProps {
  id: string;
  auditType: string;
  overallResult: string;
  riskScore: number | null;
  runAt: string;
  runByAgentName: string | null;
  entryNumber: string | null;
}

interface ComplianceFindingsClientProps {
  findings: FindingProps[];
  recentAudits: AuditProps[];
}

const SEVERITY_ORDER: FindingSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const SEVERITY_STYLES: Record<FindingSeverity, string> = {
  CRITICAL: "bg-red-50 border-red-200 text-red-800",
  HIGH: "bg-orange-50 border-orange-200 text-orange-800",
  MEDIUM: "bg-amber-50 border-amber-200 text-amber-800",
  LOW: "bg-blue-50 border-blue-200 text-blue-800",
};

const SEVERITY_BADGE: Record<FindingSeverity, BadgeProps["variant"]> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "warning",
  LOW: "info",
};

function resultBadge(result: string): BadgeProps["variant"] {
  if (result === "Pass") return "success";
  if (result === "Fail") return "danger";
  return "neutral";
}

function FindingCard({ finding, onRunAudit, busy }: { finding: FindingProps; onRunAudit?: () => void; busy?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = finding.status === "Resolved";

  return (
    <div className={`rounded-xl border p-4 space-y-2 text-xs ${isResolved ? "opacity-60" : ""} ${SEVERITY_STYLES[finding.severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={SEVERITY_BADGE[finding.severity]}>{finding.severity}</Badge>
          <span className="font-mono text-[11px] text-ink-muted">{finding.rule}</span>
          {isResolved && <Badge variant="success">Resolved</Badge>}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-ink-muted hover:text-ink"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      <p className="font-medium text-ink leading-snug">{finding.description}</p>

      {finding.filing && (
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/app/filing/${finding.filing.id}`}
            className="text-brand font-semibold hover:underline"
          >
            Entry {finding.filing.entryNumber}
          </Link>
          <span className="text-ink-muted">&middot;</span>
          <span className="text-ink-muted">{finding.filing.importerName}</span>
          <span className="text-ink-muted">&middot;</span>
          <Badge variant="neutral">{finding.filing.filingStatus}</Badge>
        </div>
      )}

      {expanded && (
        <div className="pt-2 border-t border-current/10 space-y-2">
          {finding.recommendation && (
            <p className="text-ink-muted">
              <span className="font-bold">Recommendation: </span>
              {finding.recommendation}
            </p>
          )}
          <div className="flex items-center gap-4 text-[10px] text-ink-muted flex-wrap">
            <span>Detected {displayDate(finding.createdAt)}</span>
            {finding.resolvedAt && <span>Resolved {displayDate(finding.resolvedAt)}</span>}
            {finding.assignedToName && <span>Assigned to {finding.assignedToName}</span>}
            {finding.confidence !== null && <span>Confidence {finding.confidence}%</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ComplianceFindingsClient({ findings, recentAudits }: ComplianceFindingsClientProps) {
  const router = useRouter();
  const [runningAudit, setRunningAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSuccess, setAuditSuccess] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccessUrl, setExportSuccessUrl] = useState<string | null>(null);
  const [showAudits, setShowAudits] = useState(false);

  const openFindings = findings.filter((f) => f.status !== "Resolved");
  const resolvedFindings = findings.filter((f) => f.status === "Resolved");

  const grouped = SEVERITY_ORDER.reduce<Record<FindingSeverity, FindingProps[]>>(
    (acc, sev) => {
      acc[sev] = openFindings.filter((f) => f.severity === sev);
      return acc;
    },
    { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] }
  );

  async function handleRunAudit() {
    setRunningAudit(true);
    setAuditError(null);
    setAuditSuccess(null);
    try {
      const res = await fetch("/api/compliance/audits/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Audit run failed.");
      }
      setAuditSuccess(
        `Audit complete — ${data.newFindingsCount ?? 0} new finding(s) detected. Overall result: ${data.auditRecord?.overallResult ?? "unknown"}.`
      );
      router.refresh();
    } catch (err: unknown) {
      setAuditError(err instanceof Error ? err.message : "Audit failed.");
    } finally {
      setRunningAudit(false);
    }
  }

  async function handleExportCompliance() {
    setExporting(true);
    setExportError(null);
    setExportSuccessUrl(null);
    try {
      const res = await fetch("/api/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Export failed.");
      }
      setExportSuccessUrl(data.downloadUrl);
      window.open(data.downloadUrl, "_blank");
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const criticalCount = grouped.CRITICAL.length;
  const highCount = grouped.HIGH.length;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {SEVERITY_ORDER.map((sev) => (
          <Card key={sev} className={`text-center py-4 ${SEVERITY_STYLES[sev]}`}>
            <p className="text-2xl font-extrabold">{grouped[sev].length}</p>
            <p className="text-xs font-bold uppercase tracking-wider mt-1">{sev}</p>
          </Card>
        ))}
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          {criticalCount + highCount > 0 ? (
            <span className="flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {criticalCount + highCount} critical or high finding(s) require attention
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              No critical or high findings open
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleRunAudit}
            loading={runningAudit}
            disabled={runningAudit}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Run Compliance Audit
          </Button>

          <Button
            variant="secondary"
            onClick={handleExportCompliance}
            loading={exporting}
            disabled={exporting}
          >
            <Download className="w-3.5 h-3.5" />
            Export Compliance Record
          </Button>
        </div>
      </div>

      {auditError && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {auditError}
        </p>
      )}
      {auditSuccess && (
        <p role="status" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          {auditSuccess}
        </p>
      )}
      {exportError && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {exportError}
        </p>
      )}
      {exportSuccessUrl && (
        <div role="status" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <span>Compliance export successfully generated and uploaded.</span>
          <a href={exportSuccessUrl} target="_blank" rel="noopener noreferrer" className="underline font-bold">
            Click here to download if it did not start automatically
          </a>
        </div>
      )}

      {/* Open findings grouped by severity */}
      {openFindings.length === 0 ? (
        <Card className="text-center py-12 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="text-sm font-bold text-ink">No open compliance findings</p>
          <p className="text-xs text-ink-muted">
            Run a compliance audit to check all active filings against the compliance checklist.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {SEVERITY_ORDER.map((sev) => {
            const items = grouped[sev];
            if (items.length === 0) return null;
            return (
              <div key={sev} className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${sev === "CRITICAL" ? "bg-red-500" : sev === "HIGH" ? "bg-orange-500" : sev === "MEDIUM" ? "bg-amber-500" : "bg-blue-500"}`} />
                  {sev} ({items.length})
                </h2>
                <div className="space-y-2">
                  {items.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolved findings (collapsed by default) */}
      {resolvedFindings.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAudits((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-ink-muted hover:text-ink"
          >
            {showAudits ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Resolved findings ({resolvedFindings.length})
          </button>
          {showAudits && (
            <div className="space-y-2">
              {resolvedFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent audit records */}
      {recentAudits.length > 0 && (
        <Card className="space-y-3">
          <h3 className="text-xs font-extrabold text-ink uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-brand" />
            Recent Audit Runs
          </h3>
          <div className="space-y-2">
            {recentAudits.map((audit) => (
              <div
                key={audit.id}
                className="flex items-center justify-between py-2 border-b border-border text-xs last:border-0"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={resultBadge(audit.overallResult)}>{audit.overallResult}</Badge>
                    {audit.entryNumber && (
                      <span className="text-ink-muted">Entry {audit.entryNumber}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-ink-muted">
                    {audit.runByAgentName ?? "System"} &middot; {displayDate(audit.runAt)}
                  </p>
                </div>
                {audit.riskScore !== null && (
                  <span className={`text-sm font-extrabold ${audit.riskScore > 50 ? "text-red-600" : audit.riskScore > 20 ? "text-amber-600" : "text-emerald-600"}`}>
                    {audit.riskScore}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
