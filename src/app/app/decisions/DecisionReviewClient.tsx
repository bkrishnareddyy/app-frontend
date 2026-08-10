"use client";

import { RawExtractionModal } from "@/components/RawExtractionModal";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Scale,
  Sparkles,
  CheckCircle2,
  Clock,
  Search,
  Check,
  RotateCcw,
  BookOpen,
  FileText,
  X,
  ChevronDown,
  ChevronUp,
  Layers,
} from "lucide-react";

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

function reviewerName(user: any): string | null {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null;
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
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(
    initialDecisionId || null
  );
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [notesByDecision, setNotesByDecision] = useState<Record<string, string>>({});
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "NEED_REVIEW" | "APPROVED">("NEED_REVIEW");

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || groups[0];
  const shipment = selectedGroup?.decisions[0]?.shipment;
  const lineItems: any[] = shipment?.lineItems || [];

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
      setExpandedDecisionId(null);
    }
  }, [filteredGroups, selectedGroupId]);

  const expandedDecision = selectedGroup?.decisions.find((d) => d.id === expandedDecisionId) || null;

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

  const renderExtractedMetadata = (dec: any) => {
    const evItems = dec?.evidenceItems && typeof dec.evidenceItems === "object" ? (dec.evidenceItems as Record<string, any>) : {};
    const fields: Array<{ label: string; value: any }> = [
      { label: "Shipper / Exporter", value: evItems.exporterName },
      { label: "Consignee / Importer", value: evItems.importerName },
      { label: "Country of Origin", value: evItems.originCountry },
      { label: "Incoterms", value: evItems.incoterm },
      { label: "Currency", value: evItems.currency },
      { label: "Entry Type", value: evItems.entryType },
    ];

    return (
      <div className="space-y-3 pt-1">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
          {fields.map((f) => (
            <div key={f.label} className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
              <p className="text-[9px] text-[#86868B] uppercase font-bold">{f.label}</p>
              <p className="font-bold text-[#1D1D1F] text-[11px]">
                {f.value || <span className="italic font-normal text-amber-700">Not Extracted</span>}
              </p>
            </div>
          ))}
        </div>

        {dec.agentName.includes("Intelligence") && (
          <div className="space-y-1.5 pt-1">
            <h4 className="text-[10px] font-bold uppercase text-[#86868B] tracking-wider">Extracted Line Items ({lineItems.length})</h4>
            {lineItems.length > 0 ? (
              <div className="border border-[#E5E5EA] rounded-xl overflow-hidden text-[11px]">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[9px] font-bold text-[#86868B] uppercase">
                    <tr>
                      <th className="p-2">SKU</th>
                      <th className="p-2">Description</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E5EA]">
                    {lineItems.map((item: any, idx: number) => (
                      <tr key={idx}>
                        <td className="p-2 font-mono text-[#0071E3] font-semibold">{item.sku || `SKU-${idx + 1}`}</td>
                        <td className="p-2 font-medium text-[#1D1D1F]">{item.description}</td>
                        <td className="p-2 text-right font-mono">{item.quantity || "—"}</td>
                        <td className="p-2 text-right font-mono font-bold">
                          {item.totalAmount ? `$${item.totalAmount.toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[11px] text-[#86868B]">No line items extracted yet.</p>
            )}
          </div>
        )}
      </div>
    );
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

  const rightPanelDecision = expandedDecision || selectedGroup?.decisions.find((d) => d.status !== "Approved") || selectedGroup?.decisions[0];
  const groupDataSources = Array.from(new Set(selectedGroup?.decisions.flatMap((d) => d.dataSources || []) || []));
  const groupRegulations = Array.from(new Set(selectedGroup?.decisions.flatMap((d) => d.regulations || []) || []));

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {initialShipmentId && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-2.5 text-xs text-blue-900">
          <div className="flex items-center space-x-2">
            <Scale className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
            <span>
              Showing decisions for{" "}
              <Link href={`/app/shipments/${initialShipmentId}`} className="font-bold hover:underline">
                this shipment
              </Link>{" "}
              only ({localDecisions.length} agent checks across {groups.length} document {groups.length === 1 ? "review" : "reviews"})
            </span>
          </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: one card per document review batch */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Document Reviews ({filteredGroups.length})</h3>
            </div>

            <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
              {filteredGroups.map((g) => {
                const isSelected = selectedGroup?.id === g.id;
                const approvedCount = g.decisions.filter((d) => d.status === "Approved").length;

                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(g.id);
                      setExpandedDecisionId(null);
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

        {/* Center Column: merged review for the selected document */}
        <div className="lg:col-span-5 space-y-6">
          {selectedGroup ? (
            <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E5EA] pb-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center space-x-2 min-w-0">
                    <FileText className="w-5 h-5 text-[#0071E3] shrink-0" />
                    <h2
                      onClick={() => primaryDoc && setIsPreviewOpen(true)}
                      className={`text-lg font-extrabold text-[#0071E3] min-w-0 break-words ${primaryDoc ? "hover:underline cursor-pointer" : ""}`}
                      title={primaryDoc ? "Click to view document" : undefined}
                    >
                      {selectedGroup.documentName}
                    </h2>
                  </div>
                  <p className="text-xs text-[#86868B]">
                    {selectedGroup.decisions.length} agent checks ·{" "}
                    <Link href={`/app/shipments/${selectedGroup.shipmentId}`} className="font-mono text-[#0071E3] hover:underline font-bold">
                      {selectedGroup.shipmentNumber}
                    </Link>
                  </p>
                </div>

                <button
                  onClick={handleApproveAll}
                  disabled={bulkApproving || selectedGroup.status === "Approved"}
                  className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{bulkApproving ? "Approving..." : selectedGroup.status === "Approved" ? "All Approved" : "Approve All"}</span>
                </button>
              </div>

              {actionSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              {/* Merged list of every agent check that ran on this document */}
              <div className="space-y-2">
                {selectedGroup.decisions.map((dec) => {
                  const isExpanded = expandedDecisionId === dec.id;
                  const isBusy = actionLoadingId === dec.id;
                  const reviewer = reviewerName(dec.reviewedByUser);

                  return (
                    <div key={dec.id} className="rounded-xl border border-[#E5E5EA] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedDecisionId(isExpanded ? null : dec.id)}
                        className="w-full text-left p-3 bg-[#F9F9FB] hover:bg-[#F5F5F7] cursor-pointer flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <Sparkles className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                          <div className="min-w-0">
                            <p className="font-bold text-[#1D1D1F] truncate">{dec.agentName}</p>
                            <p className="text-[10px] text-[#86868B] truncate">{dec.decisionSummary || "Evaluated compliance rules."}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <span
                            className={`font-bold text-[10px] ${
                              dec.confidence >= 90 ? "text-emerald-700" : dec.confidence > 0 ? "text-amber-700" : "text-red-600"
                            }`}
                          >
                            {dec.confidence}%
                          </span>
                          <span
                            className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                              dec.status === "Approved"
                                ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                : dec.status === "Rejected"
                                ? "bg-red-100 text-red-900 border-red-300"
                                : "bg-amber-100 text-amber-900 border-amber-300"
                            }`}
                          >
                            {dec.status}
                          </span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-[#86868B]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#86868B]" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 space-y-3 border-t border-[#E5E5EA]">
                          {renderExtractedMetadata(dec)}

                          {dec.agentName.includes("HTS") && (
                            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200 grid grid-cols-2 gap-3 text-xs">
                              <div className="p-2.5 rounded-xl bg-white border border-blue-100 space-y-1">
                                <p className="text-[9px] text-[#86868B] uppercase font-bold">Product</p>
                                <p className="font-bold text-[#1D1D1F]">{dec.proposedDescription || "Import Product"}</p>
                              </div>
                              <div className="p-2.5 rounded-xl bg-blue-100/50 border border-blue-200 space-y-1">
                                <p className="text-[9px] text-[#0071E3] uppercase font-bold">Assigned HTS Code</p>
                                <p className="font-mono font-extrabold text-[#0071E3]">
                                  {dec.proposedHtsCode || dec.currentHtsCode || "UNCLASSIFIABLE"}
                                </p>
                              </div>
                            </div>
                          )}

                          {(dec.rulesApplied || []).length > 0 && (
                            <div className="space-y-1.5">
                              <h4 className="text-[10px] font-bold uppercase text-[#86868B] tracking-wider">Applied Compliance Rules</h4>
                              {dec.rulesApplied.map((rule: string, idx: number) => (
                                <div key={idx} className="p-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] flex items-center space-x-2 text-[11px] text-[#1D1D1F]">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span className="font-medium">{rule}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {reviewer && dec.status !== "Review Required" && (
                            <p className="text-[10px] text-[#86868B]">
                              {dec.status} by <span className="font-bold text-[#1D1D1F]">{reviewer}</span>
                            </p>
                          )}

                          <textarea
                            rows={2}
                            value={notesByDecision[dec.id] ?? dec.humanNotes ?? ""}
                            onChange={(e) => setNotesByDecision((prev) => ({ ...prev, [dec.id]: e.target.value }))}
                            placeholder="Broker review notes..."
                            className="w-full p-2.5 bg-[#F5F5F7] border border-[#E5E5EA] focus:border-[#0071E3] focus:bg-white rounded-xl text-[11px] text-[#1D1D1F] transition-all outline-none font-medium"
                          />

                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => handleRowAction(dec.id, "RE_EVALUATE")}
                              disabled={isBusy}
                              className="px-3 py-1.5 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-amber-700 text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Re-evaluate</span>
                            </button>
                            <button
                              onClick={() => handleRowAction(dec.id, "REJECT")}
                              disabled={isBusy}
                              className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors"
                            >
                              <X className="w-3 h-3" />
                              <span>Reject</span>
                            </button>
                            <button
                              onClick={() => handleRowAction(dec.id, "APPROVE")}
                              disabled={isBusy || dec.status === "Approved"}
                              className="px-3.5 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors"
                            >
                              <Check className="w-3 h-3" />
                              <span>{isBusy ? "Saving..." : "Approve"}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#E5E5EA] text-xs text-[#86868B]">
              Select a document review from the left queue.
            </div>
          )}
        </div>

        {/* Right Column: data provenance for the expanded (or first pending) check */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
              {expandedDecision ? `Data Engines — ${expandedDecision.agentName}` : "AI Data Engines Used"}
            </h3>
            <div className="space-y-2 text-xs">
              {(expandedDecision ? expandedDecision.dataSources || [] : groupDataSources).length > 0 ? (
                (expandedDecision ? expandedDecision.dataSources : groupDataSources).map((src: string, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center space-x-2">
                    <Sparkles className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                    <span className="font-semibold text-[#1D1D1F] text-[11px]">{src}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-[#86868B]">Expand an agent check to see the engines it used.</p>
              )}
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">CBP Regulations &amp; Legal Authorities</h3>
            <div className="space-y-2 text-xs">
              {(expandedDecision ? expandedDecision.regulations || [] : groupRegulations).length > 0 ? (
                (expandedDecision ? expandedDecision.regulations : groupRegulations).map((reg: string, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-blue-50/50 border border-blue-100 flex items-center space-x-2">
                    <BookOpen className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                    <span className="font-mono font-bold text-[#0071E3] text-[11px]">{reg}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-[#86868B]">No specific regulation cited yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {isPreviewOpen && primaryDoc && (
        <RawExtractionModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          documentId={primaryDoc.id}
          fileName={primaryDoc.fileName}
          shipmentNumber={selectedGroup?.shipmentNumber}
          fileUrl={primaryDoc.fileUrl}
          proxyUrl={primaryDoc.fileUrl ? getProxyUrl(primaryDoc.fileUrl) : undefined}
        />
      )}
    </div>
  );
}
