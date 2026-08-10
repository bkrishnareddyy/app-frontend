"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Code, FileText, ExternalLink, Edit2, RotateCcw } from "lucide-react";

interface ExtractionPayload {
  extractedJson?: {
    keyValuePairs?: Record<string, unknown>;
    extractionStatus?: string;
  } | null;
  rawContent?: string | null;
}

type ReviewAction = "APPROVE" | "REJECT" | "RE_EVALUATE";

export interface DocumentReviewPanelProps {
  documentId: string;
  fileName: string;
  shipmentNumber?: string | null;
  fileUrl?: string | null;
  proxyUrl?: string;
  // Agent checks that ran on this document. When provided, the panel opens
  // to a "Field Review" tab that presents each check as a plain field/value
  // row instead of the raw document -- brokers care about the resulting
  // data, not which agent produced it.
  decisions?: any[];
  notesByDecision?: Record<string, string>;
  onNotesChange?: (decisionId: string, value: string) => void;
  onReviewAction?: (decisionId: string, action: ReviewAction) => void | Promise<void>;
  actionLoadingId?: string | null;
  // Rendered next to the header title, e.g. an "Approve All" button when
  // embedded on a page that has bulk actions.
  headerRight?: React.ReactNode;
  // Present only when this panel is inside a modal dialog -- renders the X
  // button and lets the caller close the overlay. Omit when embedding this
  // panel directly on a page (no overlay to close).
  onClose?: () => void;
  // id placed on the subtitle line so a wrapping dialog can point
  // aria-labelledby at it. Not needed for inline (non-dialog) embedding.
  titleId?: string;
}

function fieldLabel(dec: any): string {
  if (dec.proposedHtsCode || dec.currentHtsCode) return "HTS Classification";
  return String(dec.agentName || "Field").replace(/\s*Agent$/i, "").trim();
}

function fieldValue(dec: any): string | null {
  if (dec.proposedHtsCode || dec.currentHtsCode) {
    return dec.proposedHtsCode || dec.currentHtsCode;
  }
  // evidenceItems is untyped Json and varies by agent -- sometimes a flat
  // {fieldName: value} map, sometimes an array of evidence objects. Only
  // primitive values make sense as a single displayed "value"; anything
  // else (nested objects/arrays) falls through to the decision summary.
  const evItems = dec?.evidenceItems && typeof dec.evidenceItems === "object" ? (dec.evidenceItems as Record<string, any>) : {};
  const firstEvidenceValue = Object.values(evItems).find(
    (v) => v !== null && v !== undefined && v !== "" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
  );
  if (firstEvidenceValue !== undefined) return String(firstEvidenceValue);
  return dec.decisionSummary || null;
}

function statusPillClass(status: string): string {
  if (status === "Approved") return "bg-emerald-100 text-emerald-900 border-emerald-300";
  if (status === "Rejected") return "bg-red-100 text-red-900 border-red-300";
  return "bg-amber-100 text-amber-900 border-amber-300";
}

export function DocumentReviewPanel({
  documentId,
  fileName,
  shipmentNumber = null,
  proxyUrl,
  decisions = [],
  notesByDecision = {},
  onNotesChange,
  onReviewAction,
  actionLoadingId = null,
  headerRight,
  onClose,
  titleId,
}: DocumentReviewPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<ExtractionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const hasFieldReview = decisions.length > 0;

  // Field Review opens first when agent checks are available -- the whole
  // point is to lead with results, not the raw document.
  const [activeTab, setActiveTab] = useState<"FIELDS" | "DOC" | "KV" | "JSON">(hasFieldReview ? "FIELDS" : "DOC");

  // Document renaming state. This holds only the in-progress edit; the name
  // shown everywhere else comes straight from the fileName prop.
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState(fileName);
  const [renaming, setRenaming] = useState(false);

  // This panel can stay mounted across document selections when embedded
  // inline on a page (unlike a modal, which unmounts on close), so switching
  // documentId has to reset per-document UI state instead of relying on
  // remount.
  useEffect(() => {
    setActiveTab(hasFieldReview ? "FIELDS" : "DOC");
    setIsEditingName(false);
    setEditingNameValue(fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/extractions`, {
          signal: controller.signal,
        });
        const resData = await res.json();
        if (cancelled) return;
        setData(resData);
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          console.error("Error fetching raw extraction:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [documentId]);

  const runExtraction = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/extractions`, { method: "POST" });
      const resData = await res.json();
      if (!res.ok) {
        setExtractError(resData?.error?.message ?? "Extraction failed.");
        return;
      }
      setData(resData);
      router.refresh();
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  const jsonString = data?.extractedJson
    ? JSON.stringify(data.extractedJson, null, 2)
    : JSON.stringify(
        {
          documentId,
          shipmentNumber,
          fileName,
          extractedData: "Extraction pending vision agent processing",
        },
        null,
        2
      );

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenameDocument = async () => {
    if (editingNameValue.trim() === "" || editingNameValue.trim() === fileName) {
      setIsEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fileName: editingNameValue.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to rename document");
      }

      setIsEditingName(false);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to rename document");
      setEditingNameValue(fileName);
    } finally {
      setRenaming(false);
    }
  };

  const isImageFile = (url: string, name: string) => {
    const ext = (url || name).toLowerCase();
    return ext.includes(".png") || ext.includes(".jpg") || ext.includes(".jpeg") || ext.includes(".webp");
  };

  const isPdfFile = (url: string, name: string) => {
    const ext = (url || name).toLowerCase();
    return ext.includes(".pdf");
  };

  const kvPairs = data?.extractedJson?.keyValuePairs || {};
  const kvEntries = Object.entries(kvPairs);
  const isPending = data?.extractedJson?.extractionStatus === "PENDING_VISION_PROCESSING";

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 shrink-0 gap-3">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3] shrink-0">
            <Code className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            {isEditingName ? (
              <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={editingNameValue}
                  onChange={(e) => setEditingNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameDocument();
                    if (e.key === "Escape") {
                      setIsEditingName(false);
                      setEditingNameValue(fileName);
                    }
                  }}
                  className="px-2.5 py-1 text-sm font-extrabold text-[#1D1D1F] border border-[#0071E3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white w-64"
                  disabled={renaming}
                  autoFocus
                />
                <button
                  onClick={handleRenameDocument}
                  disabled={renaming}
                  className="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setIsEditingName(false);
                    setEditingNameValue(fileName);
                  }}
                  disabled={renaming}
                  className="p-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <h3 className="text-base font-extrabold text-[#1D1D1F] flex items-center space-x-2 group min-w-0">
                <span className="truncate">{fileName}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingNameValue(fileName);
                    setIsEditingName(true);
                  }}
                  className="p-1 rounded hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                  title="Rename Document"
                >
                  <Edit2 className="w-3.5 h-3.5 animate-in fade-in" />
                </button>
              </h3>
            )}
            <p id={titleId} className="text-xs text-[#86868B] mt-0.5">
              {hasFieldReview ? (
                <>
                  {decisions.length} agent checks
                  {shipmentNumber && (
                    <>
                      {" · "}
                      <span className="font-mono text-[#0071E3] font-bold">{shipmentNumber}</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  Neutral OCR &amp; Raw Extraction Vault
                  {shipmentNumber && (
                    <>
                      {" • Shipment: "}
                      <span className="font-mono text-[#0071E3] font-bold">{shipmentNumber}</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          {headerRight}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tab Selection Bar */}
      <div className="flex items-center justify-between bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5EA] text-xs shrink-0">
        <div className="flex items-center space-x-1">
          {hasFieldReview && (
            <button
              onClick={() => setActiveTab("FIELDS")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                activeTab === "FIELDS" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              Field Review ({decisions.length})
            </button>
          )}
          <button
            onClick={() => setActiveTab("DOC")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === "DOC" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            Document Preview
          </button>
          <button
            onClick={() => setActiveTab("KV")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === "KV" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            Neutral Key-Value Pairs ({kvEntries.length})
          </button>
          <button
            onClick={() => setActiveTab("JSON")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              activeTab === "JSON" ? "bg-white text-[#0071E3] shadow-2xs" : "text-[#86868B] hover:text-[#1D1D1F]"
            }`}
          >
            Raw Extraction JSON Blob
          </button>
        </div>

        {activeTab === "JSON" && (
          <button
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-[#1D1D1F] font-bold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#0071E3]" />}
            <span>{copied ? "Copied!" : "Copy JSON"}</span>
          </button>
        )}
      </div>

      {/* Content Box */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs py-12">
            <span>Loading raw extraction data...</span>
          </div>
        ) : activeTab === "FIELDS" ? (
          <div className="flex-1 overflow-y-auto border border-[#E5E5EA] rounded-2xl p-4 bg-[#F9F9FB] space-y-2.5 text-xs">
            {decisions.map((dec) => {
              const isBusy = actionLoadingId === dec.id;
              const value = fieldValue(dec);

              return (
                <div key={dec.id} className="p-3.5 rounded-xl bg-white border border-[#E5E5EA] shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-[#1D1D1F] text-[13px]">{fieldLabel(dec)}</span>
                    <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${statusPillClass(dec.status)}`}>
                      {dec.status}
                    </span>
                  </div>
                  <p className="font-mono font-bold text-[#1D1D1F] text-[12px] break-words">
                    {value || <span className="italic font-normal text-amber-700">Not Extracted</span>}
                  </p>
                  <input
                    type="text"
                    value={notesByDecision[dec.id] ?? dec.humanNotes ?? ""}
                    onChange={(e) => onNotesChange?.(dec.id, e.target.value)}
                    placeholder="Comment..."
                    className="w-full px-3 py-2 bg-[#F5F5F7] border border-[#E5E5EA] focus:border-[#0071E3] focus:bg-white rounded-lg text-[11px] text-[#1D1D1F] transition-all outline-none font-medium"
                  />
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={() => onReviewAction?.(dec.id, "RE_EVALUATE")}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-amber-700 text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Re-evaluate</span>
                    </button>
                    <button
                      onClick={() => onReviewAction?.(dec.id, "REJECT")}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <X className="w-3 h-3" />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => onReviewAction?.(dec.id, "APPROVE")}
                      disabled={isBusy || dec.status === "Approved"}
                      className="px-3.5 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg flex items-center space-x-1 transition-colors cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>{isBusy ? "Saving..." : "Approve"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
            {decisions.length === 0 && (
              <div className="p-8 text-center text-[#86868B]">No agent checks yet for this document.</div>
            )}
          </div>
        ) : activeTab === "DOC" ? (
          <div className="flex-1 overflow-y-auto bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA] p-4 flex items-center justify-center min-h-[350px]">
            {proxyUrl ? (
              isImageFile(proxyUrl, fileName) ? (
                // next/image is deliberately not used: these are tenant documents
                // served through an authenticated proxy, and routing them via the
                // image optimizer would cache customs paperwork outside that path.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proxyUrl}
                  alt={fileName}
                  className="max-h-[55vh] rounded-xl border border-[#E5E5EA] shadow-md object-contain"
                />
              ) : isPdfFile(proxyUrl, fileName) ? (
                <iframe
                  src={proxyUrl}
                  className="w-full h-[55vh] rounded-xl border border-[#E5E5EA]"
                  title={fileName}
                />
              ) : (
                <div className="text-center p-8 space-y-3">
                  <FileText className="w-12 h-12 text-[#0071E3] mx-auto" />
                  <div>
                    <h4 className="font-extrabold text-[#1D1D1F] text-sm">{fileName}</h4>
                    <p className="text-xs text-[#86868B] mt-1">Binary trade file stored securely in Qubere Document Vault.</p>
                  </div>
                  <a
                    href={proxyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-[#0071E3] text-white text-xs font-semibold hover:bg-[#0077ED] transition-colors"
                  >
                    <span>Open File in New Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )
            ) : (
              <div className="text-center p-8 space-y-3">
                <FileText className="w-12 h-12 text-[#86868B]/50 mx-auto" />
                <div>
                  <h4 className="font-extrabold text-[#1D1D1F] text-sm">{fileName}</h4>
                  <p className="text-xs text-[#86868B] mt-1">Document preview is currently unavailable.</p>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "KV" ? (
          <div className="flex-1 overflow-y-auto border border-[#E5E5EA] rounded-2xl p-4 bg-[#F9F9FB] space-y-3 text-xs">
            {kvEntries.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {kvEntries.map(([k, v], idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-white border border-[#E5E5EA] space-y-0.5 shadow-2xs">
                    <p className="text-[11px] text-[#86868B] font-bold uppercase">{k}</p>
                    <p className="font-extrabold text-[#1D1D1F] break-words">
                      {v !== null && v !== undefined ? String(v) : (
                        <span className="italic font-normal text-amber-700">Not Present (Null)</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-[#86868B]">
                <p className="font-bold text-[#1D1D1F]">No key-value pairs extracted</p>
                {isPending ? (
                  <>
                    <p className="text-sm mt-1">This document has not been processed yet.</p>
                    <button
                      onClick={runExtraction}
                      disabled={extracting}
                      className="mt-4 px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                      {extracting ? "Extracting..." : "Run extraction"}
                    </button>
                    {extractError && (
                      <p className="text-sm mt-2 text-red-600">{extractError}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm mt-1">
                    The document was processed but no fields were discovered. Raw content is
                    preserved in the JSON payload.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-[#1E1E1E] text-emerald-400 p-4 rounded-2xl font-mono text-xs shadow-inner leading-relaxed select-all">
            <pre className="whitespace-pre-wrap break-all">{jsonString}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
