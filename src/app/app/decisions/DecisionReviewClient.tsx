"use client";

import { DocumentReviewPanel } from "@/components/DocumentReviewPanel";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Scale, CheckCircle2, Clock, Search, Check, FileText, Layers } from "lucide-react";

interface DecisionReviewClientProps {
  decisions: any[];
  allDocuments?: any[];
  initialDecisionId?: string;
  initialShipmentId?: string;
  initialAgentName?: string;
}

// One document upload triggers the full agent pipeline (up to 10 agents),
// each writing its own AgentDecision row. AgentDecision has no documentId or
// runId to group by, so decisions from the same shipment that landed within
// this gap are treated as one review batch -- same time-clustering approach
// already proven for AgentExecutionLog grouping (see agentInvocations.ts),
// wide enough to cover a slow agent run without merging genuinely separate
// upload events (which in practice are minutes to days apart, not seconds).
const CLUSTER_GAP_MS = 15 * 60 * 1000;

interface DecisionGroup {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  documentName: string;
  documentId?: string;
  decisions: any[];
  status: "Needs Review" | "Approved";
  latestCreatedAt: string;
}

function groupDecisions(decisions: any[], allDocuments: any[]): DecisionGroup[] {
  const sorted = [...decisions].sort((a, b) => {
    if (a.shipmentId !== b.shipmentId) return a.shipmentId < b.shipmentId ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const groups: DecisionGroup[] = [];
  let current: any[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const shipmentId = current[0].shipmentId;
    const shipmentNumber = current[0].shipment?.shipmentNumber || shipmentId;
    const clusterStart = new Date(current[0].createdAt).getTime();
    const clusterEnd = new Date(current[current.length - 1].createdAt).getTime();
    const midpoint = (clusterStart + clusterEnd) / 2;

    // Best-effort attribution to the document that was actually uploaded
    // around this batch of agent activity, instead of always defaulting to
    // "the shipment's first document" regardless of which upload triggered
    // these specific decisions.
    const shipmentDocs = allDocuments.filter((d) => d.shipmentId === shipmentId);
    let bestDoc = shipmentDocs[0];
    let bestDelta = Infinity;
    for (const d of shipmentDocs) {
      const delta = Math.abs(new Date(d.createdAt).getTime() - midpoint);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestDoc = d;
      }
    }

    const allApproved = current.every((d) => d.status === "Approved");

    groups.push({
      id: current[0].id,
      shipmentId,
      shipmentNumber,
      documentName: bestDoc?.fileName || "Uploaded document",
      documentId: bestDoc?.id,
      decisions: current,
      status: allApproved ? "Approved" : "Needs Review",
      latestCreatedAt: current[current.length - 1].createdAt,
    });
    current = [];
  };

  for (const dec of sorted) {
    if (current.length === 0) {
      current.push(dec);
      continue;
    }
    const last = current[current.length - 1];
    const sameShipment = dec.shipmentId === last.shipmentId;
    const gap = new Date(dec.createdAt).getTime() - new Date(last.createdAt).getTime();
    if (sameShipment && gap <= CLUSTER_GAP_MS) {
      current.push(dec);
    } else {
      flush();
      current.push(dec);
    }
  }
  flush();

  groups.sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime());
  return groups;
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
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
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
      setSelectedGroupId(filteredGroups[0].id);
    }
  }, [filteredGroups, selectedGroupId]);

  const runDecisionAction = async (decisionId: string, action: "APPROVE" | "REJECT" | "RE_EVALUATE") => {
    setActionLoadingId(decisionId);
    setActionSuccess(null);
    const newStatus = action === "APPROVE" ? "Approved" : action === "REJECT" ? "Rejected" : "In Progress";

    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId, action, humanNotes: notesByDecision[decisionId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      setLocalDecisions((prev) => prev.map((d) => (d.id === decisionId ? { ...d, status: newStatus } : d)));
      return true;
    } catch (err: any) {
      alert(`Action failed: ${err.message || String(err)}`);
      return false;
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRowAction = async (decisionId: string, action: "APPROVE" | "REJECT" | "RE_EVALUATE") => {
    const ok = await runDecisionAction(decisionId, action);
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
      const results = await Promise.all(pending.map((d) => runDecisionAction(d.id, "APPROVE")));
      const succeeded = results.filter(Boolean).length;
      setActionSuccess(`Approved ${succeeded} of ${pending.length} agent checks for this document.`);
      router.refresh();
    } finally {
      setBulkApproving(false);
    }
  };

  const getProxyUrl = (url: string) => {
    if (!url || url === "#") return "#";
    if (url.includes("vercel-storage.com")) return `/api/documents/proxy?url=${encodeURIComponent(url)}`;
    return url;
  };

  if (initialShipmentId && localDecisions.length === 0) {
    return (
      <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
        <div className="bg-white p-12 rounded-3xl border border-[#E5E5EA] text-center space-y-3">
          <Scale className="w-10 h-10 text-[#86868B] mx-auto opacity-50" />
          <h3 className="text-sm font-bold text-[#1D1D1F]">No AI decisions yet for this shipment</h3>
          <p className="text-xs text-[#86868B] max-w-sm mx-auto">
            Agent decisions will appear here once this shipment's documents have been processed.
          </p>
          <Link href={`/app/shipments/${initialShipmentId}`} className="inline-block text-xs font-semibold text-[#0071E3] hover:underline">
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
          <Link href="/app/decisions" className="font-semibold text-[#0071E3] hover:underline shrink-0">
            View All Decisions →
          </Link>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[#1D1D1F] tracking-tight">Document &amp; Agent Decision Review Center</h1>
              <p className="text-xs text-[#86868B]">One card per uploaded document — every agent check it triggered, reviewed together.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex flex-wrap items-center gap-1 bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA]">
            <button
              onClick={() => setActiveFilter("ALL")}
              className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeFilter === "ALL" ? "bg-white text-[#1D1D1F] shadow-2xs" : "text-[#86868B]"
              }`}
            >
              All ({groups.length})
            </button>
            <button
              onClick={() => setActiveFilter("NEED_REVIEW")}
              className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeFilter === "NEED_REVIEW" ? "bg-amber-500 text-white shadow-2xs" : "text-[#86868B]"
              }`}
            >
              Needs Review ({groups.filter((g) => g.status === "Needs Review").length})
            </button>
            <button
              onClick={() => setActiveFilter("APPROVED")}
              className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeFilter === "APPROVED" ? "bg-emerald-600 text-white shadow-2xs" : "text-[#86868B]"
              }`}
            >
              Approved ({groups.filter((g) => g.status === "Approved").length})
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search document or agent..."
              className="pl-9 pr-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] focus:border-[#0071E3] focus:bg-white rounded-xl text-xs text-[#1D1D1F] w-64 transition-all outline-none font-medium"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: one card per document review batch */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Document Reviews ({filteredGroups.length})</h3>
            </div>

            <div className="space-y-3 max-h-[78vh] overflow-y-auto pr-1">
              {filteredGroups.map((g) => {
                const isSelected = selectedGroup?.id === g.id;
                const approvedCount = g.decisions.filter((d) => d.status === "Approved").length;

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
                        ? "bg-blue-50/80 border-[#0071E3] shadow-md ring-2 ring-[#0071E3]/20"
                        : "bg-[#F5F5F7] border-[#E5E5EA] hover:border-[#0071E3] hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-start space-x-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#0071E3] shrink-0 mt-0.5" />
                        <span className="font-extrabold text-[#1D1D1F] min-w-0 break-all">{g.documentName}</span>
                      </div>
                      <span
                        className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 whitespace-nowrap ${
                          g.status === "Needs Review" ? "bg-amber-100 text-amber-900 border-amber-300" : "bg-emerald-100 text-emerald-900 border-emerald-300"
                        }`}
                      >
                        {g.status}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 text-[10px] font-bold text-[#0071E3]">
                      <Layers className="w-3 h-3" />
                      <span>
                        {approvedCount} of {g.decisions.length} agent checks approved
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[10px]">
                      <span className="font-mono text-[#0071E3] font-bold">{g.shipmentNumber}</span>
                      <span className="text-[#86868B] flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(g.latestCreatedAt).toLocaleDateString()}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredGroups.length === 0 && (
                <div className="p-8 text-center text-xs text-[#86868B]">No document reviews match this filter.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: the document, its fields, and review actions -- inline, not a popup */}
        <div className="lg:col-span-8">
          {selectedGroup && primaryDoc ? (
            <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs h-[80vh] flex flex-col">
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
                proxyUrl={primaryDoc.fileUrl ? getProxyUrl(primaryDoc.fileUrl) : undefined}
                decisions={selectedGroup.decisions}
                notesByDecision={notesByDecision}
                onNotesChange={(id, val) => setNotesByDecision((prev) => ({ ...prev, [id]: val }))}
                onReviewAction={handleRowAction}
                actionLoadingId={actionLoadingId}
                headerRight={
                  <button
                    onClick={handleApproveAll}
                    disabled={bulkApproving || selectedGroup.status === "Approved"}
                    className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{bulkApproving ? "Approving..." : selectedGroup.status === "Approved" ? "All Approved" : "Approve All"}</span>
                  </button>
                }
              />
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#E5E5EA] text-xs text-[#86868B]">
              Select a document review from the left queue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
