"use client";

import { RawExtractionModal } from "@/components/RawExtractionModal";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Scale,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  Check,
  RotateCcw,
  BookOpen,
  FileText,
  Eye,
  X,
  ExternalLink,
  BrainCircuit,
  Lightbulb,
  Upload,
} from "lucide-react";

interface DecisionReviewClientProps {
  decisions: any[];
  allDocuments?: any[];
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
    setLocalDecisions(decisions);
  }, [decisions]);

  const [selectedId, setSelectedId] = useState<string>(
    initialDecisionId ||
      (initialShipmentId && initialAgentName
        ? localDecisions.find(
            (d) =>
              d.shipmentId === initialShipmentId &&
              d.agentName.toLowerCase().includes(initialAgentName.toLowerCase())
          )?.id
        : null) ||
      (initialAgentName
        ? localDecisions.find((d) => d.agentName.toLowerCase().includes(initialAgentName.toLowerCase()))?.id
        : null) ||
      localDecisions.find((d) => (initialShipmentId ? d.shipmentId === initialShipmentId : true))?.id ||
      localDecisions[0]?.id ||
      ""
  );

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [humanNotes, setHumanNotes] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "NEED_REVIEW" | "APPROVED">("NEED_REVIEW");

  const selectedDecision = localDecisions.find((d) => d.id === selectedId) || localDecisions[0];

  // Document provenance
  const shipment = selectedDecision?.shipment;
  const primaryDoc =
    shipment?.documents?.[0] ||
    allDocuments.find((d) => d.shipmentId === shipment?.id) ||
    (selectedDecision?.documentId ? allDocuments.find((d) => d.id === selectedDecision.documentId) : null);
  const docName = primaryDoc?.fileName || "ForwardingInstructions_1.pdf";
  const docUrl = primaryDoc?.fileUrl || "#";
  const docType = primaryDoc?.docType || "Commercial Invoice";

  // Data sources & regulations
  const dataSources: string[] = selectedDecision?.dataSources || [];
  const regulations: string[] = selectedDecision?.regulations || [];
  const rulesApplied: string[] = selectedDecision?.rulesApplied || [];
  const lineItems: any[] = shipment?.lineItems || [];

  // Filtered decisions list
  const filteredDecisions = localDecisions.filter((d) => {
    const statusMatch =
      activeFilter === "ALL"
        ? true
        : activeFilter === "NEED_REVIEW"
        ? d.status === "Review Required" || d.status === "Needs Review"
        : d.status === "Approved";

    if (!statusMatch) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const docNameLow = (d.shipment?.documents?.[0]?.name || "").toLowerCase();
    return (
      d.agentName.toLowerCase().includes(q) ||
      (d.decisionSummary && d.decisionSummary.toLowerCase().includes(q)) ||
      (d.shipment?.shipmentNumber && d.shipment.shipmentNumber.toLowerCase().includes(q)) ||
      docNameLow.includes(q)
    );
  });

  // Auto-advance to next queue item when current is approved/filtered out
  useEffect(() => {
    if (filteredDecisions.length > 0 && !filteredDecisions.some((d) => d.id === selectedId)) {
      setSelectedId(filteredDecisions[0].id);
    }
  }, [filteredDecisions, selectedId]);

  const handleAction = async (action: "APPROVE" | "REJECT" | "RE_EVALUATE") => {
    if (!selectedDecision) return;
    setActionLoading(true);
    setActionSuccess(null);

    const newStatus = action === "APPROVE" ? "Approved" : action === "REJECT" ? "Rejected" : "In Progress";

    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisionId: selectedDecision.id,
          action,
          humanNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      // Update local state reactively
      setLocalDecisions(prev => prev.map(d => d.id === selectedDecision.id ? { ...d, status: newStatus } : d));

      setActionSuccess(
        action === "APPROVE"
          ? "Decision Approved & Signed into Database Audit Log."
          : action === "REJECT"
          ? "Decision Rejected. Flagged for human broker override."
          : "Re-evaluation requested."
      );
      router.refresh();
    } catch (err: any) {
      alert(`Action failed: ${err.message || String(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const getProxyUrl = (url: string) => {
    if (!url || url === "#") return "#";
    if (url.includes("vercel-storage.com")) {
      return `/api/documents/proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // Helper to generate human "What AI Learnt" takeaway text
  const getWhatAiLearnt = (dec: any) => {
    if (!dec) return "AI evaluated document structure and trade taxonomy rules.";
    if (dec.agentName.includes("Intake")) {
      return `Identified document as "${dec.proposedDescription || "Trade Document Packet"}". Verified page stitching and layout per 19 CFR § 141.86.`;
    }
    if (dec.agentName.includes("Intelligence")) {
      return `Parsed trade document. Discovered exporter, importer, country of origin, and line items. Primary filing agency: CBP.`;
    }
    if (dec.agentName.includes("HTS")) {
      return `Classified product under HTS ${dec.proposedHtsCode || "UNCLASSIFIABLE"} (${dec.proposedDescription || "Goods"}). Applied General Rules of Interpretation (GRI 1, GRI 6).`;
    }
    return dec.decisionSummary || "Evaluated compliance rules and verified database records.";
  };

  const renderExtractedMetadata = () => {
    const evItems = (selectedDecision?.evidenceItems && typeof selectedDecision.evidenceItems === "object")
      ? (selectedDecision.evidenceItems as Record<string, any>)
      : {};

    const exporterVal = evItems.exporterName || null;
    const importerVal = evItems.importerName || null;
    const originVal = evItems.originCountry || null;
    const incotermVal = evItems.incoterm || null;
    const currencyVal = evItems.currency || null;
    const entryTypeVal = evItems.entryType || null;

    return (
      <div className="space-y-4 pt-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
          Extracted Trade Metadata Fields
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[10px] text-[#86868B] uppercase font-bold">Shipper / Exporter</p>
            <p className="font-bold text-[#1D1D1F]">
              {exporterVal ? exporterVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[10px] text-[#86868B] uppercase font-bold">Consignee / Importer</p>
            <p className="font-bold text-[#1D1D1F]">
              {importerVal ? importerVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[10px] text-[#86868B] uppercase font-bold">Country of Origin</p>
            <p className="font-bold text-[#1D1D1F]">
              {originVal ? originVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[10px] text-[#86868B] uppercase font-bold">Incoterms</p>
            <p className="font-bold text-[#1D1D1F]">
              {incotermVal ? incotermVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[10px] text-[#86868B] uppercase font-bold">Currency</p>
            <p className="font-bold text-[#1D1D1F]">
              {currencyVal ? currencyVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[10px] text-[#86868B] uppercase font-bold">Entry Type</p>
            <p className="font-bold text-[#1D1D1F]">
              {entryTypeVal ? entryTypeVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
        </div>

        {/* Extracted Line Items Table */}
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-bold text-[#1D1D1F]">Extracted Line Items ({lineItems.length})</h4>
          {lineItems.length > 0 ? (
            <div className="border border-[#E5E5EA] rounded-xl overflow-hidden text-xs">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[10px] font-bold text-[#86868B] uppercase">
                  <tr>
                    <th className="p-2.5">SKU</th>
                    <th className="p-2.5">Description</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right">Unit Price</th>
                    <th className="p-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {lineItems.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-[#F5F5F7]/50">
                      <td className="p-2.5 font-mono text-[#0071E3] font-semibold">{item.sku || `SKU-${idx + 1}`}</td>
                      <td className="p-2.5 font-medium text-[#1D1D1F]">{item.description}</td>
                      <td className="p-2.5 text-right font-mono">{item.quantity || "—"}</td>
                      <td className="p-2.5 text-right font-mono">${item.unitPrice ? item.unitPrice.toFixed(2) : "—"}</td>
                      <td className="p-2.5 text-right font-mono font-bold">${item.totalAmount ? item.totalAmount.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
              <p className="font-bold">No Commercial Line Items Extracted</p>
              <p className="text-[11px]">
                Document requires vision extraction with active Gemini API key.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[#1D1D1F] tracking-tight">
                Document &amp; Agent Decision Review Center
              </h1>
              <p className="text-xs text-[#86868B]">
                Human-in-the-loop audit console for document extractions, AI learnings &amp; customs classifications
              </p>
            </div>
          </div>
        </div>

        {/* Filter & Search */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA]">
            <button
              onClick={() => setActiveFilter("ALL")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeFilter === "ALL" ? "bg-white text-[#1D1D1F] shadow-2xs" : "text-[#86868B]"
              }`}
            >
              All ({localDecisions.length})
            </button>
            <button
              onClick={() => setActiveFilter("NEED_REVIEW")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeFilter === "NEED_REVIEW" ? "bg-amber-500 text-white shadow-2xs" : "text-[#86868B]"
              }`}
            >
              Needs Review ({localDecisions.filter((d) => d.status === "Review Required" || d.status === "Needs Review" || d.status === "In Progress" || d.status === "Pending").length})
            </button>
            <button
              onClick={() => setActiveFilter("APPROVED")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeFilter === "APPROVED" ? "bg-emerald-600 text-white shadow-2xs" : "text-[#86868B]"
              }`}
            >
              Approved ({localDecisions.filter((d) => d.status === "Approved").length})
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

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Document & Agent Decision List (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                Document Audit Queue ({filteredDecisions.length})
              </h3>
            </div>

            <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
              {filteredDecisions.map((dec) => {
                const isSelected = selectedDecision?.id === dec.id;
                const itemDoc =
                  dec.shipment?.documents?.[0] ||
                  allDocuments.find((d) => d.shipmentId === dec.shipmentId) ||
                  allDocuments[0] ||
                  null;
                const itemDocName = itemDoc?.fileName || itemDoc?.name || dec.proposedDescription || dec.agentName;
                const itemDocUrl = itemDoc?.fileUrl || itemDoc?.url || "";

                return (
                  <div
                    key={dec.id}
                    onClick={() => {
                      setSelectedId(dec.id);
                      setHumanNotes(dec.humanNotes || "");
                      setActionSuccess(null);
                    }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all text-xs cursor-pointer space-y-2.5 ${
                      isSelected
                        ? "bg-blue-50/80 border-[#0071E3] shadow-md ring-2 ring-[#0071E3]/20"
                        : "bg-[#F5F5F7] border-[#E5E5EA] hover:border-[#0071E3] hover:bg-white"
                    }`}
                  >
                    {/* Row 1: <Name of Doc> • <Status> */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-2 truncate">
                        <FileText className="w-4 h-4 text-[#0071E3] shrink-0" />
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(dec.id);
                            setIsPreviewOpen(true);
                          }}
                          className="font-extrabold text-[#0071E3] hover:underline cursor-pointer truncate text-xs flex items-center space-x-1"
                          title="Click to view document modal"
                        >
                          <span>{itemDocName}</span>
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 ${
                          dec.status === "Review Required" || dec.status === "Needs Review"
                            ? "bg-amber-100 text-amber-900 border-amber-300"
                            : dec.status === "Approved"
                            ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                            : "bg-red-100 text-red-900 border-red-300"
                        }`}
                      >
                        {dec.status}
                      </span>
                    </div>

                    {/* Row 2: Factual Agent Summary */}
                    <div className="p-2.5 rounded-xl bg-white border border-[#E5E5EA] space-y-1">
                      <div className="flex items-center space-x-1.5 text-[10px] font-bold text-[#0071E3]">
                        <Sparkles className="w-3 h-3" />
                        <span>{dec.agentName}</span>
                      </div>
                      <p className="text-[11px] text-[#1D1D1F] line-clamp-2 leading-snug font-medium">
                        {dec.decisionSummary || "Evaluated compliance rules."}
                      </p>
                    </div>

                    {/* Row 3: <Shipment Info> • <Confidence> */}
                    <div className="flex items-center justify-between pt-1 text-[10px]">
                      <span className="font-mono text-[#0071E3] font-bold">
                        {dec.shipment?.shipmentNumber || "SHP-2026"}
                      </span>

                      <span
                        className={`font-bold ${
                          dec.confidence >= 90
                            ? "text-emerald-700"
                            : dec.confidence > 0
                            ? "text-amber-700"
                            : "text-red-600"
                        }`}
                      >
                        {dec.confidence}% Conf.
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center Column: Detailed Workstation View (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {selectedDecision ? (
            <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-6">
              {/* Row 1: Document Title & Status Badge */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E5EA] pb-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-[#0071E3]" />
                    <h2
                      onClick={() => setIsPreviewOpen(true)}
                      className="text-lg font-extrabold text-[#0071E3] hover:underline cursor-pointer"
                      title="Click to view document modal"
                    >
                      {docName}
                    </h2>
                  </div>
                  <p className="text-xs text-[#86868B]">
                    Agent Evaluated: <span className="font-bold text-[#1D1D1F]">{selectedDecision.agentName}</span>
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-extrabold border ${
                      selectedDecision.status === "Approved"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {selectedDecision.status}
                  </span>
                </div>
              </div>

              {/* Agent Executive Summary */}
              <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1.5 shadow-2xs">
                <div className="flex items-center space-x-2 text-[#0071E3]">
                  <Sparkles className="w-4 h-4" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#1D1D1F]">
                    Agent Audit Summary ({selectedDecision.agentName})
                  </h3>
                </div>
                <p className="text-xs text-[#1D1D1F] font-medium leading-relaxed">
                  {selectedDecision.decisionSummary || "Evaluated document structure and compliance rules against database state."}
                </p>
              </div>

              {/* Row 3: Shipment Info */}
              <div className="p-3.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between text-xs">
                <div>
                  <span className="text-[#86868B]">Target Shipment: </span>
                  {shipment ? (
                    <Link
                      href={`/app/shipments/${shipment.id}`}
                      className="font-mono text-[#0071E3] hover:text-[#0077ED] font-bold hover:underline"
                    >
                      {shipment.shipmentNumber}
                    </Link>
                  ) : (
                    <span className="font-mono text-[#86868B] font-bold">N/A</span>
                  )}
                  <span className="text-[#86868B] ml-2">• Confidence: </span>
                  <span className="font-bold text-emerald-700">{selectedDecision.confidence}%</span>
                </div>
              </div>

              {/* Extracted Fields & Line Items Grid */}
              {selectedDecision.agentName.includes("Intelligence") && renderExtractedMetadata()}

              {/* HTS Classification View */}
              {selectedDecision.agentName.includes("HTS") && (
                <div className="space-y-3 pt-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                    HTS Classification Summary
                  </h3>

                  <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-xl bg-white border border-blue-100 space-y-1">
                        <p className="text-[10px] text-[#86868B] uppercase font-bold">Input Product Description</p>
                        <p className="font-bold text-[#1D1D1F]">{selectedDecision.proposedDescription || "Import Product"}</p>
                      </div>

                      <div className="p-3 rounded-xl bg-blue-100/50 border border-blue-200 space-y-1">
                        <p className="text-[10px] text-[#0071E3] uppercase font-bold">Assigned 10-Digit HTS Code</p>
                        <p className="font-mono text-base font-extrabold text-[#0071E3]">
                          {selectedDecision.proposedHtsCode || selectedDecision.currentHtsCode || "UNCLASSIFIABLE"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Applied Trade Rules List */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Applied Compliance Rules</h3>
                <div className="space-y-1.5 text-xs">
                  {rulesApplied.map((rule: string, idx: number) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center space-x-2 text-[#1D1D1F]">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="font-medium">{rule}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Success Alert */}
              {actionSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              {/* Human Audit & Sign-off Notes */}
              <div className="space-y-2 pt-2 border-t border-[#E5E5EA]">
                <label className="text-xs font-bold text-[#1D1D1F]">Licensed Customs Broker Sign-Off Notes</label>
                <textarea
                  rows={3}
                  value={humanNotes}
                  onChange={(e) => setHumanNotes(e.target.value)}
                  placeholder="Enter broker review notes or sign-off rationale..."
                  className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5EA] focus:border-[#0071E3] focus:bg-white rounded-xl text-xs text-[#1D1D1F] transition-all outline-none font-medium"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-2 border-t border-[#E5E5EA]">
                <button
                  onClick={() => handleAction("RE_EVALUATE")}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-amber-700 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Request Re-evaluation</span>
                </button>
                <button
                  onClick={() => handleAction("REJECT")}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject Decision</span>
                </button>
                <button
                  onClick={() => handleAction("APPROVE")}
                  disabled={actionLoading}
                  className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve Decision</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#E5E5EA] text-xs text-[#86868B]">
              Select a document audit item from the left queue to review.
            </div>
          )}
        </div>

        {/* Right Column: Real Data Provenance & Regulations (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          {/* AI Data Engines */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
              AI Data Engines Used
            </h3>

            <div className="space-y-2 text-xs">
              {dataSources.length > 0 ? (
                dataSources.map((src, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center space-x-2">
                    <Sparkles className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                    <span className="font-semibold text-[#1D1D1F] text-[11px]">{src}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-[#86868B]">Engine provenance logged in database.</p>
              )}
            </div>
          </div>

          {/* CBP Regulations & Legal Authorities */}
          <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
              CBP Regulations &amp; Legal Authorities
            </h3>

            <div className="space-y-2 text-xs">
              {regulations.length > 0 ? (
                regulations.map((reg, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-blue-50/50 border border-blue-100 flex items-center space-x-2">
                    <BookOpen className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                    <span className="font-mono font-bold text-[#0071E3] text-[11px]">{reg}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-[#86868B]">No specific regulation cited for this step.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* DOCUMENT PREVIEW MODAL */}
      {isPreviewOpen && primaryDoc && (
        <RawExtractionModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          documentId={primaryDoc.id}
          fileName={primaryDoc.fileName || docName}
          shipmentNumber={shipment?.shipmentNumber || "SHP-2026"}
          fileUrl={docUrl}
          proxyUrl={docUrl ? getProxyUrl(docUrl) : undefined}
        />
      )}
    </div>
  );
}
