"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileCheck,
  AlertCircle,
  Clock,
  ArrowRightLeft,
  CheckCircle2,
  Filter,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface IssueProps {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  severity: string;
  field: string;
  expectedValue: string;
  actualValue: string;
  sourceDocuments: string[];
  status: string;
  issueType: string;
  resolution: string | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  deadlines: Array<{ type: string; dueAt: string | null }>;
}

export function ReconciliationClient({ issues: initialIssues }: { issues: IssueProps[] }) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("Open");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filteredIssues = issues.filter((i) => {
    if (filterStatus !== "ALL" && i.status !== filterStatus) return false;
    if (filterType !== "ALL" && i.issueType !== filterType) return false;
    return true;
  });

  const pscCandidatesCount = issues.filter((i) => i.issueType === "PSC_CANDIDATE" && i.status === "Open").length;
  const entryDiscrepanciesCount = issues.filter((i) => i.issueType === "ENTRY_DISCREPANCY" && i.status === "Open").length;
  const documentConflictsCount = issues.filter((i) => i.issueType === "DOCUMENT_CONFLICT" && i.status === "Open").length;

  async function convertToPsc(issueId: string) {
    try {
      setBusyId(issueId);
      const res = await fetch(`/api/reconciliation/${issueId}/convert-to-psc`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error?.message || "Failed to convert to PSC");
        return;
      }

      setIssues((prev) =>
        prev.map((i) =>
          i.id === issueId
            ? { ...i, status: "Resolved", note: `Converted to PSC #${data.psc.id}` }
            : i
        )
      );
      router.refresh();
    } catch (e) {
      alert("Error converting issue to Post-Summary Correction.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">Reconciliation Control Center</h1>
          <p className="text-xs text-slate-500">Track entry discrepancies, document conflicts, and convert candidates into Post-Summary Corrections (PSC).</p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-purple-50 border border-purple-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-purple-700 uppercase tracking-wider">PSC Candidates</span>
            <p className="text-2xl font-extrabold text-purple-900 mt-1">{pscCandidatesCount}</p>
          </div>
          <ArrowRightLeft className="w-8 h-8 text-purple-500 opacity-80" />
        </Card>

        <Card className="p-4 bg-amber-50 border border-amber-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-amber-700 uppercase tracking-wider">Entry Discrepancies</span>
            <p className="text-2xl font-extrabold text-amber-900 mt-1">{entryDiscrepanciesCount}</p>
          </div>
          <AlertCircle className="w-8 h-8 text-amber-500 opacity-80" />
        </Card>

        <Card className="p-4 bg-blue-50 border border-blue-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider">Document Conflicts</span>
            <p className="text-2xl font-extrabold text-blue-900 mt-1">{documentConflictsCount}</p>
          </div>
          <FileCheck className="w-8 h-8 text-blue-500 opacity-80" />
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-muted p-3 rounded-xl border border-border">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-ink-muted" />
          <span className="text-xs font-bold text-ink">Filters:</span>
          
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs bg-white border border-border rounded-lg px-2.5 py-1.5 font-medium text-ink focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="Open">Open Issues</option>
            <option value="Resolved">Resolved Issues</option>
            <option value="ALL">All Statuses</option>
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs bg-white border border-border rounded-lg px-2.5 py-1.5 font-medium text-ink focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="ALL">All Issue Types</option>
            <option value="PSC_CANDIDATE">PSC Candidate</option>
            <option value="ENTRY_DISCREPANCY">Entry Discrepancy</option>
            <option value="DOCUMENT_CONFLICT">Document Conflict</option>
          </select>
        </div>

        <span className="text-xs font-bold text-ink-muted">
          Showing {filteredIssues.length} of {issues.length} issues
        </span>
      </div>

      {/* Issue Table */}
      {filteredIssues.length === 0 ? (
        <Card className="p-8 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No Reconciliation Issues Found</h3>
          <p className="text-xs text-slate-500">All cross-document extractions and entry declarations are in alignment.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredIssues.map((issue) => {
            const pscDeadline = issue.deadlines.find((d) => d.type === "PSC_WINDOW");
            const isNearLiquidation = pscDeadline && pscDeadline.dueAt && new Date(pscDeadline.dueAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;

            return (
              <Card key={issue.id} className="p-4 hover:shadow-md transition-shadow space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={issue.issueType === "PSC_CANDIDATE" ? "neutral" : issue.issueType === "ENTRY_DISCREPANCY" ? "warning" : "info"}>
                      {issue.issueType.replace("_", " ")}
                    </Badge>
                    <span className="text-xs font-extrabold text-slate-800">Field: {issue.field}</span>
                    <span className="text-xs text-slate-400">•</span>
                    <Link href={`/app/shipments/${issue.shipmentId}`} className="text-xs font-bold text-brand hover:underline flex items-center gap-1">
                      Shipment #{issue.shipmentNumber}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>

                  <div className="flex items-center gap-2">
                    {isNearLiquidation && (
                      <Badge variant="danger" className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>Near Liquidation Deadline</span>
                      </Badge>
                    )}
                    <Badge variant={issue.status === "Open" ? "warning" : "success"}>
                      {issue.status}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-surface-muted p-2.5 rounded-lg space-y-0.5">
                    <span className="text-[10px] font-bold text-ink-muted uppercase">Expected Value</span>
                    <p className="font-mono font-bold text-emerald-700">{issue.expectedValue}</p>
                  </div>
                  <div className="bg-surface-muted p-2.5 rounded-lg space-y-0.5">
                    <span className="text-[10px] font-bold text-ink-muted uppercase">Actual Discrepant Value</span>
                    <p className="font-mono font-bold text-rose-700">{issue.actualValue}</p>
                  </div>
                  <div className="bg-surface-muted p-2.5 rounded-lg space-y-0.5">
                    <span className="text-[10px] font-bold text-ink-muted uppercase">Source Documents</span>
                    <p className="font-bold text-ink truncate">{issue.sourceDocuments.join(", ") || "Invoice / Entry Summary"}</p>
                  </div>
                </div>

                {issue.note && (
                  <p className="text-xs text-slate-500 italic bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                    Note: {issue.note}
                  </p>
                )}

                {issue.status === "Open" && (issue.issueType === "PSC_CANDIDATE" || issue.issueType === "ENTRY_DISCREPANCY") && (
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => convertToPsc(issue.id)}
                      loading={busyId === issue.id}
                      className="text-xs flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Convert to Post-Summary Correction (PSC)</span>
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
