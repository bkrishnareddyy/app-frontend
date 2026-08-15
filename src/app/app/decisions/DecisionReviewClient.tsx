"use client";

import { DocumentReviewPanel, type ReviewDecision } from "@/components/DocumentReviewPanel";
import { documentViewUrl } from "@/lib/documentUrl";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Scale, CheckCircle2, Clock, Search, Check, FileText } from "lucide-react";
import {
  groupDecisions,
  type DecisionRow,
  type DecisionDocument,
} from "@/modules/decisions/groupDecisions";
import { useDecisionActions } from "@/lib/decisions/useDecisionActions";

// Re-export ReviewDecision so callers that import it from here still work.
export type { ReviewDecision };

interface DecisionReviewClientProps {
  decisions: DecisionRow[];
  allDocuments?: DecisionDocument[];
  initialDecisionId?: string;
  initialShipmentId?: string;
  initialAgentName?: string;
}

export function DecisionReviewClient({
  decisions,
  allDocuments = [],
  initialDecisionId,
  initialShipmentId,
  initialAgentName,
}: DecisionReviewClientProps) {
  const router = useRouter();
  const [localDecisions, setLocalDecisions] = useState(decisions);

  useEffect(() => {
    // Resyncs the local copy after router.refresh() returns new server data.
    setLocalDecisions(decisions);
  }, [decisions]);

  const groups = useMemo(() => groupDecisions(localDecisions, allDocuments), [localDecisions, allDocuments]);

  const findInitialGroupId = () => {
    if (initialDecisionId) {
      const g = groups.find((gr) => gr.decisions.some((d) => d.id === initialDecisionId));
      if (g) return g.id;
    }
    if (initialAgentName) {
      const g = groups.find(
        (gr) =>
          (!initialShipmentId || gr.shipmentId === initialShipmentId) &&
          gr.decisions.some((d) => d.agentName.toLowerCase().includes(initialAgentName.toLowerCase()))
      );
      if (g) return g.id;
    }
    if (initialShipmentId) {
      const g = groups.find((gr) => gr.shipmentId === initialShipmentId);
      if (g) return g.id;
    }
    return groups[0]?.id || "";
  };

  const [selectedGroupId, setSelectedGroupId] = useState<string>(findInitialGroupId());
  const [notesByDecision, setNotesByDecision] = useState<Record<string, string>>({});
  const [bulkApproving, setBulkApproving] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "NEED_REVIEW" | "APPROVED">("NEED_REVIEW");

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || groups[0];

  const primaryDoc =
    allDocuments.find((d) => d.id === selectedGroup?.documentId) ||
    allDocuments.find((d) => d.shipmentId === selectedGroup?.shipmentId) ||
    null;

  const filteredGroups = groups.filter((g) => {
    const statusMatch =
      activeFilter === "ALL" ? true : activeFilter === "NEED_REVIEW" ? g.status === "Needs Review" : g.status === "Approved";
    if (!statusMatch) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      g.documentName.toLowerCase().includes(q) ||
      g.shipmentNumber.toLowerCase().includes(q) ||
      g.decisions.some((d) => d.agentName.toLowerCase().includes(q) || (d.decisionSummary || "").toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    if (filteredGroups.length > 0 && !filteredGroups.some((g) => g.id === selectedGroupId)) {
      // Keeps the selection valid when the active filter removes the selected group.
      setSelectedGroupId(filteredGroups[0].id);
    }
  }, [filteredGroups, selectedGroupId]);

  const { actionLoadingId, runDecisionAction } = useDecisionActions((decisionId, newStatus) => {
    setLocalDecisions((prev) => prev.map((d) => (d.id === decisionId ? { ...d, status: newStatus } : d)));
  });

  const handleRowAction = async (decisionId: string, action: "APPROVE" | "REJECT" | "RE_EVALUATE") => {
    const ok = await runDecisionAction(decisionId, action, notesByDecision[decisionId]);
    if (ok) {
      setActionSuccess(
        action === "APPROVE" ? "Approved & signed into audit log." : action === "REJECT" ? "Rejected." : "Re-evaluation requested."
      );
      router.refresh();
    }
  };

  const handleApproveAll = async () => {
    if (!selectedGroup) return;
    const pending = selectedGroup.decisions.filter((d) => d.status !== "Approved");
    if (pending.length === 0) return;
    setBulkApproving(true);
    setActionSuccess(null);
    try {
      const results = await Promise.all(
        pending.map((d) => runDecisionAction(d.id, "APPROVE", notesByDecision[d.id]))
      );
      const succeeded = results.filter(Boolean).length;
      setActionSuccess(`Approved ${succeeded} of ${pending.length} agent checks for this document.`);
      router.refresh();
    } finally {
      setBulkApproving(false);
    }
  };

  const getProxyUrl = (url: string, documentId: string) => {
    if (!url || url === "#") return "#";
    if (url.includes("vercel-storage.com")) return documentViewUrl(documentId);
    return url;
  };

  if (initialShipmentId && localDecisions.length === 0) {
    return (
      <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
        <div className="bg-white p-12 rounded-3xl border border-border text-center space-y-3">
          <Scale className="w-10 h-10 text-ink-muted mx-auto opacity-50" />
          <h3 className="text-sm font-bold text-ink">No AI decisions yet for this shipment</h3>
          <p className="text-xs text-ink-muted max-w-sm mx-auto">
            Agent decisions will appear here once this shipment&apos;s documents have been processed.
          </p>
          <Link href={`/app/shipments/${initialShipmentId}`} className="inline-block text-xs font-semibold text-brand hover:underline">
            ← Back to Shipment
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {initialShipmentId && (
        <div className="flex items-center justify-end bg-blue-50 border border-blue-100 rounded-2xl px-4 py-2.5 text-xs text-blue-900">
          <Link href="/app/decisions" className="font-semibold text-brand hover:underline shrink-0">
            View All Decisions →
          </Link>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-brand">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-ink tracking-tight">Document &amp; Agent Decision Review Center</h1>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex flex-wrap items-center gap-1 bg-surface-muted p-1 rounded-xl border border-border">
            <button
              onClick={() => setActiveFilter("ALL")}
              className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeFilter === "ALL" ? "bg-white text-ink shadow-2xs" : "text-ink-muted"
              }`}
            >
              All ({groups.length})
            </button>
            <button
              onClick={() => setActiveFilter("NEED_REVIEW")}
              className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeFilter === "NEED_REVIEW" ? "bg-amber-500 text-white shadow-2xs" : "text-ink-muted"
              }`}
            >
              Needs Review ({groups.filter((g) => g.status === "Needs Review").length})
            </button>
            <button
              onClick={() => setActiveFilter("APPROVED")}
              className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeFilter === "APPROVED" ? "bg-emerald-600 text-white shadow-2xs" : "text-ink-muted"
              }`}
            >
              Approved ({groups.filter((g) => g.status === "Approved").length})
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-ink-muted absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search document or agent..."
              className="pl-9 pr-4 py-2 bg-surface-muted border border-border focus:border-brand focus:bg-white rounded-xl text-xs text-ink w-64 transition-all outline-none font-medium"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: one card per document review batch */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-border shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Document Reviews ({filteredGroups.length})</h3>
            </div>

            <div className="space-y-3 max-h-[78vh] overflow-y-auto pr-1">
              {filteredGroups.map((g) => {
                const isSelected = selectedGroup?.id === g.id;

                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(g.id);
                      setActionSuccess(null);
                    }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all text-xs cursor-pointer space-y-2.5 block ${
                      isSelected
                        ? "bg-blue-50/80 border-brand shadow-md ring-2 ring-brand/20"
                        : "bg-surface-muted border-border hover:border-brand hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-start space-x-2 min-w-0">
                        <FileText className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                        <span className="font-extrabold text-ink min-w-0 break-all">{g.documentName}</span>
                      </div>
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          g.status === "Needs Review" ? "bg-amber-400" : "bg-emerald-500"
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[10px]">
                      <span className="font-mono text-brand font-bold">{g.shipmentNumber}</span>
                      <span className="text-ink-muted flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(g.latestCreatedAt).toLocaleDateString()}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredGroups.length === 0 && (
                <div className="p-8 text-center text-xs text-ink-muted">No document reviews match this filter.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: the document, its fields, and review actions -- inline, not a popup */}
        <div className="lg:col-span-8">
          {selectedGroup && primaryDoc ? (
            <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs h-[80vh] flex flex-col">
              {actionSuccess && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center space-x-2 shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}
              <DocumentReviewPanel
                documentId={primaryDoc.id}
                fileName={primaryDoc.fileName}
                shipmentNumber={selectedGroup.shipmentNumber}
                proxyUrl={primaryDoc.fileUrl ? getProxyUrl(primaryDoc.fileUrl, primaryDoc.id) : undefined}
                decisions={selectedGroup.decisions}
                notesByDecision={notesByDecision}
                onNotesChange={(id, val) => setNotesByDecision((prev) => ({ ...prev, [id]: val }))}
                onReviewAction={handleRowAction}
                actionLoadingId={actionLoadingId}
                headerRight={
                  <button
                    onClick={handleApproveAll}
                    disabled={bulkApproving || selectedGroup.status === "Approved"}
                    className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{bulkApproving ? "Approving..." : selectedGroup.status === "Approved" ? "All Approved" : "Approve All"}</span>
                  </button>
                }
              />
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-border text-xs text-ink-muted">
              Select a document review from the left queue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
