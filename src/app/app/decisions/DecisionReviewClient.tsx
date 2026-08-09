"use client";

import { RawExtractionModal } from "@/components/RawExtractionModal";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Scale,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Check,
  RotateCcw,
  BookOpen,
  FileText,
  X,
} from "lucide-react";
import { documentViewUrl } from "@/lib/documentUrl";
import { displayCurrency, displayNumber, displayPercent, displayText, NOT_PROVIDED } from "@/lib/honest";
import { DecisionFilterBar } from "./DecisionFilterBar";
import { DecisionPagination } from "./DecisionPagination";
import { ClassificationEvidencePanel } from "./ClassificationEvidencePanel";
import {
  decisionProvenance,
  isClassificationOverride,
  type Reviewer,
} from "@/modules/decisions/reviewAuthority";

interface DecisionDocument {
  id: string;
  fileName: string;
  docType: string;
  fileUrl: string | null;
  shipmentId: string;
}

interface DecisionLineItem {
  id: string;
  partNumber: string | null;
  description: string | null;
  htsCode: string | null;
  htsConfidence: number | null;
  quantity: number | null;
  // Prisma Decimal columns; serialized to a string when they cross to the client.
  unitPrice: { toString(): string } | number | string | null;
  totalValue: { toString(): string } | number | string | null;
}

interface DecisionShipment {
  id: string;
  shipmentNumber: string | null;
  documents?: DecisionDocument[];
  lineItems?: DecisionLineItem[];
}

interface Decision {
  id: string;
  shipmentId: string;
  agentName: string;
  status: string;
  confidence: number | null;
  decisionSummary: string | null;
  proposedHtsCode?: string | null;
  proposedDescription?: string | null;
  currentHtsCode?: string | null;
  humanNotes?: string | null;
  reasoning?: string | null;
  modelVersion?: string | null;
  evidenceItems?: unknown;
  dataSources?: string[];
  regulations?: string[];
  rulesApplied?: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
  reviewedByUserId?: string | null;
  reviewedByUser?: Reviewer | null;
  shipment?: DecisionShipment | null;
}

interface DecisionQueryState {
  search: string | null;
  status: string | null;
  agentName: string | null;
  confidence: string | null;
  age: string | null;
  page: number;
  pageSize: number;
}

interface ReviewPermissions {
  approve: boolean;
  reject: boolean;
  reEvaluate: boolean;
  override: boolean;
}

interface DecisionReviewClientProps {
  decisions: Decision[];
  allDocuments?: DecisionDocument[];
  initialDecisionId?: string;
  requestedDecisionMissing?: boolean;
  initialShipmentId?: string;
  initialAgentName?: string;
  total: number;
  reviewPermissions: ReviewPermissions;
  query: DecisionQueryState;
  agentNames: string[];
  statuses: string[];
}

interface ClassificationApplication {
  proposedHtsCode: string;
  htsConfidence: number | null;
  updatedLineItemIds: string[];
  skippedReason: "NO_CURRENT_HTS_CODE" | "NO_MATCHING_LINE_ITEMS" | null;
}

/** An approval that reclassified nothing must not read like one that did. */
function approvalMessage(applied: ClassificationApplication | null | undefined): string {
  const recorded = "Decision approved and recorded in the audit log.";
  if (!applied) return recorded;

  if (applied.skippedReason === "NO_CURRENT_HTS_CODE") {
    return `${recorded} ${applied.proposedHtsCode} was not applied: the decision does not say which code it replaces.`;
  }
  if (applied.skippedReason === "NO_MATCHING_LINE_ITEMS") {
    return `${recorded} ${applied.proposedHtsCode} was not applied: no line item still carries the code it replaces.`;
  }

  const count = applied.updatedLineItemIds.length;
  return `${recorded} ${applied.proposedHtsCode} applied to ${count} line item${count === 1 ? "" : "s"}.`;
}

/** Any decision on the same shipment shows those line items, so all copies move. */
function applyToDecisionLineItems(
  decision: Decision,
  applied: ClassificationApplication | null | undefined
): Decision {
  if (!applied || applied.updatedLineItemIds.length === 0) return decision;

  const items = decision.shipment?.lineItems;
  if (!items?.some((item) => applied.updatedLineItemIds.includes(item.id))) return decision;

  return {
    ...decision,
    shipment: {
      ...decision.shipment!,
      lineItems: items.map((item) =>
        applied.updatedLineItemIds.includes(item.id)
          ? { ...item, htsCode: applied.proposedHtsCode, htsConfidence: applied.htsConfidence }
          : item
      ),
    },
  };
}

export function DecisionReviewClient({
  decisions: initialDecisions,
  allDocuments = [],
  initialDecisionId,
  requestedDecisionMissing = false,
  initialShipmentId,
  initialAgentName,
  total,
  reviewPermissions,
  query,
  agentNames,
  statuses,
}: DecisionReviewClientProps) {
  const router = useRouter();

  // The reviewer's last action, laid over the server queue until router.refresh()
  // returns a list that already reflects it. Deriving rather than copying the
  // queue into state means a new server render (filter change, refresh) is never
  // masked by a stale local copy.
  const [pendingReview, setPendingReview] = useState<{
    decisionId: string;
    /** Revision the reviewer acted on; the patch retires once the server moves past it. */
    baseUpdatedAt: string | Date;
    fields: Partial<Decision>;
    classificationApplied: ClassificationApplication | null;
  } | null>(null);

  const decisions = useMemo(() => {
    if (!pendingReview) return initialDecisions;
    const server = initialDecisions.find((d) => d.id === pendingReview.decisionId);
    if (
      !server ||
      new Date(server.updatedAt).getTime() !== new Date(pendingReview.baseUpdatedAt).getTime()
    ) {
      return initialDecisions;
    }
    return initialDecisions.map((d) =>
      applyToDecisionLineItems(
        d.id === pendingReview.decisionId ? { ...d, ...pendingReview.fields } : d,
        pendingReview.classificationApplied
      )
    );
  }, [initialDecisions, pendingReview]);

  const firstOnPage = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const lastOnPage = Math.min(query.page * query.pageSize, total);
  const hasActiveFilter = Boolean(
    query.search || query.status || query.agentName || query.confidence || query.age
  );

  // A deep link can name a shipment and/or an agent instead of a decision id.
  const [selectedId, setSelectedId] = useState<string>(
    initialDecisionId ||
      (initialAgentName
        ? initialDecisions.find(
            (d) =>
              (!initialShipmentId || d.shipmentId === initialShipmentId) &&
              d.agentName.toLowerCase().includes(initialAgentName.toLowerCase())
          )?.id
        : undefined) ||
      initialDecisions.find((d) => (initialShipmentId ? d.shipmentId === initialShipmentId : true))?.id ||
      initialDecisions[0]?.id ||
      ""
  );

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [humanNotes, setHumanNotes] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedDecision = decisions.find((d) => d.id === selectedId) || decisions[0];

  // Document provenance. Only documents belonging to this decision's shipment
  // qualify -- falling back to an arbitrary document would attribute the
  // decision to a file it was never derived from.
  const shipment = selectedDecision?.shipment;
  const primaryDoc =
    shipment?.documents?.[0] ??
    allDocuments.find((d) => d.shipmentId === shipment?.id) ??
    null;

  const docName = primaryDoc?.fileName ?? null;
  const docId: string | null = primaryDoc?.id ?? null;
  const docUrl = primaryDoc?.fileUrl ?? "";

  // Data sources & regulations
  const dataSources: string[] = selectedDecision?.dataSources || [];
  const regulations: string[] = selectedDecision?.regulations || [];
  const rulesApplied: string[] = selectedDecision?.rulesApplied || [];
  const lineItems: DecisionLineItem[] = shipment?.lineItems || [];

  const provenance = decisionProvenance(selectedDecision ?? {});
  const overridesClassification = selectedDecision
    ? isClassificationOverride(selectedDecision)
    : false;
  const overrideBlocked = overridesClassification && !reviewPermissions.override;
  const noReviewPermission =
    !reviewPermissions.approve && !reviewPermissions.reject && !reviewPermissions.reEvaluate;

  // Approving removes a decision from a status-filtered queue. Falling back to
  // the head of the list here (rather than syncing selectedId in an effect)
  // keeps the panel on a real decision without an extra render pass.
  const handleAction = async (action: "APPROVE" | "REJECT" | "RE_EVALUATE") => {
    if (!selectedDecision) return;
    if (action === "REJECT" && humanNotes.trim() === "") {
      setActionError("A reason is required to reject a decision.");
      return;
    }
    setActionLoading(true);
    setActionSuccess(null);
    setActionError(null);

    const nextStatus =
      action === "APPROVE" ? "Approved" : action === "REJECT" ? "Rejected" : "In Progress";

    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisionId: selectedDecision.id,
          action,
          humanNotes,
          // Identifies the revision the reviewer actually read.
          expectedVersion: new Date(selectedDecision.updatedAt).toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      setActionSuccess(
        action === "APPROVE"
          ? approvalMessage(data.classificationApplied)
          : action === "REJECT"
          ? "Decision rejected. The reason you gave is stored on the decision and in the audit log."
          : "Re-evaluation requested."
      );

      setPendingReview({
        decisionId: selectedDecision.id,
        baseUpdatedAt: selectedDecision.updatedAt,
        fields: {
          status: nextStatus,
          updatedAt: data.decision?.updatedAt ?? selectedDecision.updatedAt,
          humanNotes: data.decision?.humanNotes ?? selectedDecision.humanNotes,
          reviewedByUserId: data.decision?.reviewedByUserId ?? selectedDecision.reviewedByUserId,
          reviewedByUser: data.decision?.reviewedByUser ?? selectedDecision.reviewedByUser,
        },
        classificationApplied: data.classificationApplied ?? null,
      });

      // Re-runs the server query so the queue, counts and paging reflect the
      // new status rather than the optimistic copy above.
      router.refresh();
    } catch (err: unknown) {
      // Surfaced in the UI; a failed mutation must never look like success.
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const getProxyUrl = (documentId?: string | null) => {
    if (!documentId) return "#";
    return documentViewUrl(documentId);
  };

  const renderExtractedMetadata = () => {
    const evItems = (selectedDecision?.evidenceItems && typeof selectedDecision.evidenceItems === "object")
      ? (selectedDecision.evidenceItems as Record<string, string | null>)
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
            <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Shipper / Exporter</p>
            <p className="font-bold text-[#1D1D1F]">
              {exporterVal ? exporterVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Consignee / Importer</p>
            <p className="font-bold text-[#1D1D1F]">
              {importerVal ? importerVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Country of Origin</p>
            <p className="font-bold text-[#1D1D1F]">
              {originVal ? originVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Incoterms</p>
            <p className="font-bold text-[#1D1D1F]">
              {incotermVal ? incotermVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Currency</p>
            <p className="font-bold text-[#1D1D1F]">
              {currencyVal ? currencyVal : <span className="italic font-normal text-amber-700">Not Extracted (Null)</span>}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-1">
            <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">Entry Type</p>
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
                <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-[11px] font-bold text-[#86868B] uppercase tracking-wider">
                  <tr>
                    <th className="p-2.5 whitespace-nowrap">Part Number</th>
                    <th className="p-2.5">Description</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right whitespace-nowrap">Unit Price</th>
                    <th className="p-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {lineItems.map((item: DecisionLineItem) => (
                    <tr key={item.id} className="hover:bg-[#F5F5F7]/50">
                      <td className="p-2.5 font-mono text-[#0071E3] font-semibold">
                        {displayText(item.partNumber, NOT_PROVIDED)}
                      </td>
                      <td className="p-2.5 font-medium text-[#1D1D1F]">{displayText(item.description, NOT_PROVIDED)}</td>
                      <td className="p-2.5 text-right font-mono">{displayNumber(item.quantity, NOT_PROVIDED)}</td>
                      <td className="p-2.5 text-right font-mono">{displayCurrency(item.unitPrice?.toString() ?? null)}</td>
                      <td className="p-2.5 text-right font-mono font-bold">{displayCurrency(item.totalValue?.toString() ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
              <p className="font-bold">No Commercial Line Items Extracted</p>
              <p className="text-sm">
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
      {requestedDecisionMissing && (
        <div
          role="status"
          className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900"
        >
          The decision this link points to is not in this account. It may have been removed. The
          queue below is showing everything else.
        </div>
      )}
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

        {/* Filter & Search
            These drive the server query. Filtering the page in the browser made
            the queue count describe the page rather than the queue. */}
        <DecisionFilterBar
          query={query}
          total={total}
          shown={decisions.length}
          agentNames={agentNames}
          statuses={statuses}
        />
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Document & Agent Decision List (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                Document Audit Queue
              </h3>
              <span className="text-xs text-[#86868B] font-medium">
                {total === 0
                  ? "0 decisions"
                  : `${firstOnPage}\u2013${lastOnPage} of ${total}`}
              </span>
            </div>

            <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
              {decisions.length === 0 && (
                <p className="text-xs text-[#86868B] py-6 text-center">
                  {hasActiveFilter
                    ? "No decisions match this view."
                    : "No agent decisions have been recorded for this account."}
                </p>
              )}
              {decisions.map((dec) => {

                const isSelected = selectedDecision?.id === dec.id;
                const itemDoc =
                  dec.shipment?.documents?.[0] ??
                  allDocuments.find((d) => d.shipmentId === dec.shipmentId) ??
                  null;
                const itemDocName = itemDoc?.fileName ?? dec.proposedDescription ?? dec.agentName;

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
                        className={`text-sm font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 ${
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
                      <div className="flex items-center space-x-1.5 text-sm font-bold text-[#0071E3]">
                        <Sparkles className="w-3 h-3" />
                        <span>{dec.agentName}</span>
                      </div>
                      <p className="text-sm text-[#1D1D1F] line-clamp-2 leading-snug font-medium">
                        {displayText(dec.decisionSummary, "No summary recorded")}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-sm">
                      <span className="font-mono text-[#0071E3] font-bold">
                        {dec.shipment?.shipmentNumber ?? <span className="text-[#86868B]">No shipment</span>}
                      </span>

                      <span
                        className={`font-bold ${
                          dec.confidence === null || dec.confidence === undefined
                            ? "text-[#86868B]"
                            : dec.confidence >= 90
                            ? "text-emerald-700"
                            : dec.confidence > 0
                            ? "text-amber-700"
                            : "text-red-600"
                        }`}
                      >
                        {displayPercent(dec.confidence)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {total > query.pageSize && (
              <div className="-mx-4 -mb-4">
                <DecisionPagination
                  page={query.page}
                  pageSize={query.pageSize}
                  total={total}
                />
              </div>
            )}
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
                      {docName ?? "No source document linked"}
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
                  {displayText(selectedDecision.decisionSummary, "No summary was recorded for this decision.")}
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
                      {displayText(shipment.shipmentNumber)}
                    </Link>
                  ) : (
                    <span className="font-mono text-[#86868B] font-bold">{NOT_PROVIDED}</span>
                  )}
                  <span className="text-[#86868B] ml-2">• Model confidence: </span>
                  <span
                    className="font-bold text-[#1D1D1F]"
                    title="How sure the model was, not a legal opinion"
                  >
                    {displayPercent(selectedDecision.confidence)}
                  </span>
                </div>
              </div>

              {/* Extracted Fields & Line Items Grid */}
              {selectedDecision.agentName.includes("Intelligence") && renderExtractedMetadata()}

              {/* HTS Classification View */}
              {selectedDecision.agentName.includes("HTS") && (
                <div className="space-y-3 pt-2">
                  <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-1">
                    <p className="text-[11px] text-[#86868B] uppercase font-bold tracking-wider">
                      Input product description
                    </p>
                    <p className="font-bold text-sm text-[#1D1D1F]">
                      {displayText(selectedDecision.proposedDescription)}
                    </p>
                  </div>

                  {/* Codes, rates, effective dates and rulings come from the tariff and
                      rulings tables, so a code that is not loaded says so. */}
                  <ClassificationEvidencePanel decisionId={selectedDecision.id} />
                </div>
              )}

              {/* Applied Trade Rules List */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">
                  Applied compliance rules
                </h3>
                <div className="space-y-1.5 text-sm">
                  {rulesApplied.length === 0 ? (
                    <p className="text-[#6E6E73]">
                      The agent did not record which rules it applied.
                    </p>
                  ) : (
                    rulesApplied.map((rule: string, idx: number) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center space-x-2 text-[#1D1D1F]">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="font-medium">{rule}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Success Alert */}
              {actionSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              {/* Action Failure Alert */}
              {actionError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-medium flex items-start space-x-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    <span className="font-bold">This action did not complete.</span> {actionError}
                  </span>
                </div>
              )}

              {/* Human Audit & Sign-off Notes */}
              <div className="space-y-2 pt-2 border-t border-[#E5E5EA]">
                <label className="text-xs font-bold text-[#1D1D1F]">Review notes</label>
                <textarea
                  rows={3}
                  value={humanNotes}
                  onChange={(e) => setHumanNotes(e.target.value)}
                  placeholder="Why you are approving, rejecting or returning this decision..."
                  className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5EA] focus:border-[#0071E3] focus:bg-white rounded-xl text-xs text-[#1D1D1F] transition-all outline-none font-medium"
                />
                <p className="text-sm text-[#86868B]">{provenance.label}</p>
              </div>

              {noReviewPermission && (
                <div
                  role="status"
                  className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-sm text-[#1D1D1F] font-medium"
                >
                  Your role holds none of decisions.approve, decisions.reject or
                  decisions.reevaluate, so the server will refuse every action below. An account
                  owner has to grant one before you can close a decision.
                </div>
              )}

              {overrideBlocked && (
                <div
                  role="status"
                  className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 font-medium"
                >
                  Approving this replaces {selectedDecision.currentHtsCode} with{" "}
                  {selectedDecision.proposedHtsCode} on the record. That is an override and your
                  role does not hold the permission for it, so the server will refuse.
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-2 border-t border-[#E5E5EA]">
                <button
                  onClick={() => handleAction("RE_EVALUATE")}
                  disabled={actionLoading || !reviewPermissions.reEvaluate}
                  className="px-4 py-2 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] disabled:text-[#86868B] text-amber-700 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Request Re-evaluation</span>
                </button>
                <button
                  onClick={() => handleAction("REJECT")}
                  disabled={actionLoading || !reviewPermissions.reject}
                  className="px-4 py-2 bg-white border border-red-200 hover:bg-red-50 disabled:text-[#86868B] text-red-600 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject Decision</span>
                </button>
                <button
                  onClick={() => handleAction("APPROVE")}
                  disabled={actionLoading || overrideBlocked || !reviewPermissions.approve}
                  className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] disabled:bg-[#86868B] text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{overridesClassification ? "Approve Override" : "Approve Decision"}</span>
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
                    <span className="font-semibold text-[#1D1D1F] text-sm">{src}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#86868B]">The agent did not record which data sources it used.</p>
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
                    <span className="font-mono font-bold text-[#0071E3] text-sm">{reg}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#86868B]">No specific regulation cited for this step.</p>
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
          fileName={primaryDoc.fileName}
          shipmentNumber={shipment?.shipmentNumber ?? null}
          fileUrl={docUrl}
          proxyUrl={docId ? getProxyUrl(docId) : undefined}
        />
      )}
    </div>
  );
}
