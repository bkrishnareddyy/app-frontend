"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Info, FileText, CheckCircle2, Pencil } from "lucide-react";
import { ExceptionResolutionModal } from "./ExceptionResolutionModal";
import { DocumentFieldReviewModal, DocumentFieldSummary } from "./DocumentFieldReviewModal";
import { DocumentReviewPanel } from "@/components/DocumentReviewPanel";
import { Modal } from "@/components/ui/Modal";
import { documentViewUrl } from "@/lib/documentUrl";
import {
  isResolvableException,
  type DbExceptionItem,
  type ExceptionCard,
  type ResolvableException,
  type ShipmentLineItemRow,
} from "./workspaceTypes";

interface ExceptionsDrawerProps {
  shipmentId: string;
  exceptionItems: DbExceptionItem[];
  lineItems: ShipmentLineItemRow[];
  // Required document types not yet uploaded, computed by the page from the
  // live document list -- surfaced here as real action cards instead of
  // living only in a separate, disconnected "Document Set Summary" box.
  missingDocumentTypes?: string[];
  // What fields we expect from each processed document, and whether each
  // one was found/confirmed -- computed server-side in page.tsx from real
  // extraction + FieldApproval data. Drives the "Document Field Review"
  // cards below, so exceptions that all trace back to one document read as
  // one review task instead of a flat, ungrouped list.
  documentFieldSummaries?: DocumentFieldSummary[];
}

export function ExceptionsDrawer({
  shipmentId,
  exceptionItems,
  lineItems,
  missingDocumentTypes = [],
  documentFieldSummaries = [],
}: ExceptionsDrawerProps) {
  const [panelTab, setPanelTab] = useState<"EXCEPTIONS" | "FIELD_REVIEW">("EXCEPTIONS");
  const [selectedException, setSelectedException] = useState<ResolvableException | null>(null);
  const [reviewingDoc, setReviewingDoc] = useState<DocumentFieldSummary | null>(null);
  const [selectedPdfDoc, setSelectedPdfDoc] = useState<DocumentFieldSummary | null>(null);

  const [approvingField, setApprovingField] = useState<string | null>(null);
  const [batchApprovingDoc, setBatchApprovingDoc] = useState<string | null>(null);

  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingInlineField, setSavingInlineField] = useState<string | null>(null);

  const handleInlineEditSave = async (docId: string, fieldKey: string) => {
    if (!editingValue.trim()) return;
    const key = `${docId}:${fieldKey}`;
    setSavingInlineField(key);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/documents/${docId}/field-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, action: "EDIT", value: editingValue.trim() }),
      });
      if (res.ok) window.location.reload();
    } catch (err) {
      console.error("Field review edit save failed", err);
    } finally {
      setSavingInlineField(null);
      setEditingFieldKey(null);
    }
  };

  const handleInlineApprove = async (docId: string, fieldKey: string, value: string) => {
    const key = `${docId}:${fieldKey}`;
    setApprovingField(key);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/documents/${docId}/field-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, action: "APPROVE", value }),
      });
      if (res.ok) window.location.reload();
    } catch (err) {
      console.error("Field review approval failed", err);
    } finally {
      setApprovingField(null);
    }
  };

  const handleBatchApprove = async (doc: DocumentFieldSummary) => {
    setBatchApprovingDoc(doc.documentId);
    try {
      const unconfirmed = doc.fields.filter((f) => f.status === "NEEDS_REVIEW" && f.value);
      await Promise.all(
        unconfirmed.map((f) =>
          fetch(`/api/shipments/${shipmentId}/documents/${doc.documentId}/field-review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldKey: f.key, action: "APPROVE", value: f.value }),
          })
        )
      );
      window.location.reload();
    } catch (err) {
      console.error("Batch approval failed", err);
    } finally {
      setBatchApprovingDoc(null);
    }
  };

  // Filter out exceptions that have been resolved
  const openExceptions = exceptionItems.filter(
    (ex) => ex.status !== "RESOLVED" && ex.status !== "Resolved"
  );

  // Map database exception items to UI objects
  const exceptions: ExceptionCard[] = openExceptions.map((dbEx) => {
    const descLower = dbEx.description.toLowerCase();
    const isHts = descLower.includes("hts");
    const isCo = descLower.includes("certificate of origin");
    const isCoo = descLower.includes("country of origin");
    const isQty = descLower.includes("quantity") || descLower.includes("pcs") || descLower.includes("mismatch");
    const isPoa = descLower.includes("poa") || descLower.includes("power of attorney");
    const isInvoiceMissing = descLower.includes("commercial invoice missing");
    const isPackingMissing = descLower.includes("packing list missing");

    let category = "VALIDATION";
    let title = dbEx.description.split(":")[0]?.trim() || "Compliance Exception";
    let desc = dbEx.description.split(":").slice(1).join(":")?.trim() || dbEx.description;
    let icon = <AlertCircle className="w-4 h-4 text-red-500" />;
    let actionText = "Resolve Exception →";
    let actionType = "DEFAULT";

    if (isInvoiceMissing) {
      category = "MISSING";
      title = "Commercial Invoice Missing";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Add Invoice →";
      actionType = "UPLOAD";
    } else if (isPackingMissing) {
      category = "MISSING";
      title = "Packing List Missing";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Add Packing List →";
      actionType = "UPLOAD";
    } else if (isHts) {
      category = "VALIDATION";
      title = "HTS Classification Review";
      icon = <AlertCircle className="w-4 h-4 text-red-500" />;
      actionText = "Review Classification →";
      actionType = "HTS";
    } else if (isCo) {
      category = "MISSING";
      title = "Certificate of Origin Missing";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Add Document →";
      actionType = "UPLOAD";
    } else if (isCoo) {
      category = "MISSING";
      title = "Country of Origin Missing";
      icon = <Info className="w-4 h-4 text-blue-500" />;
      actionText = "Provide Origin →";
      actionType = "COO";
    } else if (isQty) {
      category = "CONFLICTS";
      title = "Quantity Mismatch";
      icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
      actionText = "Review Mismatch →";
      actionType = "MISMATCH";
    } else if (isPoa) {
      category = "CONFLICTS";
      title = "Importer POA Expired";
      icon = <AlertCircle className="w-4 h-4 text-red-500" />;
      actionText = "Renew POA Consent →";
      actionType = "POA";
    }

    // Compliance Audit's findings (embargo/UFLPA/ADD-CVD/PGA/missing HTS or
    // origin) are grounded in the real DB `category` column, not description
    // keywords -- their wording can coincidentally match one of the phrases
    // above (e.g. "missing an HTS classification" matching isHts) and land in
    // the wrong tab/action with a special mutation meant for a different
    // exception type. Override using the real column for this source only, so
    // the three original checks above are untouched.
    if (dbEx.sourceAgent === "Compliance Agent") {
      const complianceCategory: Record<string, string> = {
        COMPLIANCE: "WARNINGS",
        MISSING_DATA: "MISSING",
      };
      category = (dbEx.category && complianceCategory[dbEx.category]) || "WARNINGS";
      actionType = "DEFAULT";
      actionText = "Resolve Exception →";
      icon =
        dbEx.severity === "Critical" ? (
          <AlertCircle className="w-4 h-4 text-red-500" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        );
      title = dbEx.category === "MISSING_DATA" ? "Missing Compliance Data" : "Sanctions / Compliance Finding";
      desc = dbEx.description;
    }

    return {
      id: dbEx.id,
      dbId: dbEx.id,
      version: dbEx.version,
      category,
      title,
      desc,
      icon,
      actionText,
      actionType,
    };
  });

  // Missing required documents the page detected directly from the live
  // document list -- skip any type already represented by a real DB
  // exception above so the same gap isn't shown twice.
  const missingDocExceptions: ExceptionCard[] = missingDocumentTypes
    .filter((type) => !exceptions.some((ex) => ex.title.toLowerCase().includes(type.toLowerCase())))
    .map((type) => ({
      id: `missing-doc-${type}`,
      category: "MISSING",
      title: `${type} Missing`,
      desc: `Required for customs entry filing. Upload the ${type} to clear this requirement.`,
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      actionText: `Add ${type} →`,
      actionType: "UPLOAD_DIRECT",
    }));

  const allExceptions = [...exceptions, ...missingDocExceptions];
  const totalPendingFields = documentFieldSummaries.reduce(
    (acc, doc) => acc + (doc.totalCount - doc.confirmedCount),
    0
  );

  return (
    <>
      <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs space-y-5 animate-in fade-in duration-200">
        {/* Top Navigation Pill Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 text-xs gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Standalone Pill 1: Exceptions */}
            <button
              type="button"
              onClick={() => setPanelTab("EXCEPTIONS")}
              className={`px-4 py-2 rounded-full font-bold text-xs transition-all cursor-pointer flex items-center space-x-2 border shadow-2xs ${
                panelTab === "EXCEPTIONS"
                  ? "bg-brand text-white border-brand ring-2 ring-brand/20"
                  : "bg-white text-ink border-border hover:bg-surface-muted hover:border-slate-300"
              }`}
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${panelTab === "EXCEPTIONS" ? "text-white" : "text-amber-500"}`} />
              <span>Exceptions & Action Items ({allExceptions.length})</span>
              {allExceptions.length > 0 && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    panelTab === "EXCEPTIONS"
                      ? "bg-white/20 text-white"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  {allExceptions.length} Action{allExceptions.length === 1 ? "" : "s"}
                </span>
              )}
            </button>

            {/* Standalone Pill 2: Document Field Review */}
            <button
              type="button"
              onClick={() => setPanelTab("FIELD_REVIEW")}
              className={`px-4 py-2 rounded-full font-bold text-xs transition-all cursor-pointer flex items-center space-x-2 border shadow-2xs ${
                panelTab === "FIELD_REVIEW"
                  ? "bg-brand text-white border-brand ring-2 ring-brand/20"
                  : "bg-white text-ink border-border hover:bg-surface-muted hover:border-slate-300"
              }`}
            >
              <FileText className={`w-3.5 h-3.5 ${panelTab === "FIELD_REVIEW" ? "text-white" : "text-brand"}`} />
              <span>Document Field Review ({documentFieldSummaries.length})</span>
              {totalPendingFields > 0 ? (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    panelTab === "FIELD_REVIEW"
                      ? "bg-amber-400 text-amber-950 font-extrabold"
                      : "bg-amber-100 text-amber-900 border border-amber-300"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {totalPendingFields} Pending Approval
                </span>
              ) : documentFieldSummaries.length > 0 ? (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    panelTab === "FIELD_REVIEW"
                      ? "bg-emerald-400 text-emerald-950 font-extrabold"
                      : "bg-emerald-50 text-emerald-800 border border-emerald-300"
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                  All Confirmed
                </span>
              ) : null}
            </button>
          </div>

          <Link
            href={`/app/actions?shipmentId=${shipmentId}`}
            className="text-xs font-semibold text-brand hover:underline shrink-0"
          >
            View All Actions →
          </Link>
        </div>

        {/* Tab 1: Exceptions & Action Items Grid */}
        {panelTab === "EXCEPTIONS" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
            {allExceptions.map((ex) => (
              <div
                key={ex.id}
                className="p-4 rounded-xl bg-surface-muted border border-border space-y-2 hover:border-brand transition-all duration-200"
              >
                <div className="flex items-start space-x-2 text-xs font-bold text-ink">
                  <span className="shrink-0">{ex.icon}</span>
                  <span className="min-w-0 break-words">{ex.title}</span>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">{ex.desc}</p>
                {ex.actionType === "UPLOAD_DIRECT" ? (
                  <button
                    onClick={() => window.dispatchEvent(new Event("qubere:open-upload-modal"))}
                    className="text-xs font-semibold text-brand hover:underline text-left pt-1 block w-full cursor-pointer"
                  >
                    {ex.actionText}
                  </button>
                ) : ex.actionType ? (
                  <button
                    onClick={() => {
                      if (isResolvableException(ex)) setSelectedException(ex);
                    }}
                    className="text-xs font-semibold text-brand hover:underline text-left pt-1 block w-full cursor-pointer"
                  >
                    {ex.actionText}
                  </button>
                ) : (
                  <Link
                    href={ex.actionHref || "#"}
                    className="inline-block text-xs font-semibold text-brand hover:underline pt-1"
                  >
                    {ex.actionText}
                  </Link>
                )}
              </div>
            ))}
            {allExceptions.length === 0 && (
              <div className="col-span-full py-8 text-center text-ink-muted text-xs">
                No open exceptions for this shipment.
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Document Field Review & Approval Grid */}
        {panelTab === "FIELD_REVIEW" && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-ink-muted">
                Extracted Document Fields & Verification
              </p>
              <span className="text-[10px] text-ink-muted">
                Review OCR extracted values directly or click Approve All
              </span>
            </div>
            {documentFieldSummaries.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {documentFieldSummaries.map((doc) => {
                  const allConfirmed = doc.confirmedCount === doc.totalCount;
                  const unconfirmedCount = doc.totalCount - doc.confirmedCount;
                  const isBatchLoading = batchApprovingDoc === doc.documentId;
                  return (
                    <div
                      key={doc.documentId}
                      className="p-4 rounded-xl border border-border bg-[#F9F9FB] space-y-3 transition-all duration-200"
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-brand shrink-0" />
                          <button
                            type="button"
                            onClick={() => setSelectedPdfDoc(doc)}
                            className="text-xs font-bold text-ink truncate hover:underline hover:text-brand text-left cursor-pointer"
                          >
                            {doc.fileName}
                          </button>
                          {unconfirmedCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                              {unconfirmedCount} Pending
                            </span>
                          )}
                        </div>
                        {!allConfirmed && unconfirmedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => handleBatchApprove(doc)}
                            disabled={isBatchLoading}
                            className="px-2.5 py-1 rounded-lg bg-brand text-white text-[11px] font-semibold hover:bg-brand/90 disabled:opacity-50 transition-all shrink-0 cursor-pointer shadow-2xs"
                          >
                            {isBatchLoading ? "Approving…" : `Approve All (${unconfirmedCount})`}
                          </button>
                        )}
                        {allConfirmed && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            All Confirmed
                          </span>
                        )}
                      </div>

                      {/* Flat Inline List of Extracted Fields */}
                      <div className="space-y-2">
                        {doc.fields.map((f) => {
                          const fieldKeyId = `${doc.documentId}:${f.key}`;
                          const fieldLoading = approvingField === fieldKeyId;
                          const isEditing = editingFieldKey === fieldKeyId;

                          if (isEditing) {
                            return (
                              <div
                                key={f.key}
                                className="flex items-center justify-between gap-2 text-xs p-2.5 rounded-lg bg-amber-50/70 border border-amber-300"
                              >
                                <div className="flex-1 min-w-0">
                                  <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider block">
                                    {f.label}
                                  </span>
                                  <input
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleInlineEditSave(doc.documentId, f.key);
                                      if (e.key === "Escape") setEditingFieldKey(null);
                                    }}
                                    autoFocus
                                    className="w-full mt-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-amber-300 text-ink focus:outline-none focus:ring-1 focus:ring-brand shadow-2xs"
                                    placeholder={`Enter ${f.label}…`}
                                  />
                                </div>
                                <div className="shrink-0 flex items-center gap-1.5 self-end pb-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleInlineEditSave(doc.documentId, f.key)}
                                    disabled={savingInlineField === fieldKeyId || !editingValue.trim()}
                                    className="px-2.5 py-1 rounded-md bg-brand text-white text-[11px] font-semibold hover:bg-brand/90 disabled:opacity-50 transition-all cursor-pointer shadow-2xs"
                                  >
                                    {savingInlineField === fieldKeyId ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingFieldKey(null)}
                                    className="px-2 py-1 rounded-md bg-white border border-border text-ink-muted text-[11px] font-semibold hover:bg-surface-muted transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={f.key}
                              className="flex items-center justify-between gap-3 text-xs p-2.5 rounded-lg bg-white border border-border/80 hover:border-border transition-colors group"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider block">
                                  {f.label}
                                </span>
                                <span className="font-semibold text-ink truncate block">
                                  {f.value || <span className="text-red-500 italic text-[11px]">Missing</span>}
                                </span>
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5">
                                {f.value && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingFieldKey(fieldKeyId);
                                      setEditingValue(f.value || "");
                                    }}
                                    title={`Edit ${f.label}`}
                                    className="p-1 text-ink-muted hover:text-brand hover:bg-surface-muted rounded-md transition-colors cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {f.status === "CONFIRMED" ? (
                                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Confirmed
                                  </span>
                                ) : f.value ? (
                                  <button
                                    type="button"
                                    onClick={() => handleInlineApprove(doc.documentId, f.key, f.value!)}
                                    disabled={fieldLoading || isBatchLoading}
                                    className="px-2.5 py-1 rounded-md bg-surface-muted hover:bg-emerald-50 border border-border hover:border-emerald-300 text-ink hover:text-emerald-700 text-[11px] font-semibold transition-all disabled:opacity-40 cursor-pointer"
                                  >
                                    {fieldLoading ? "Confirming…" : "Confirm ✓"}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingFieldKey(fieldKeyId);
                                      setEditingValue("");
                                    }}
                                    className="px-2.5 py-1 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-semibold hover:bg-red-100 transition-all cursor-pointer"
                                  >
                                    Provide
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-ink-muted text-xs">
                No documents uploaded for field review yet.
              </div>
            )}
          </div>
        )}
      </div>

      <ExceptionResolutionModal
        isOpen={!!selectedException}
        onClose={() => setSelectedException(null)}
        exception={selectedException}
        shipmentId={shipmentId}
        lineItems={lineItems}
      />

      <DocumentFieldReviewModal
        isOpen={!!reviewingDoc}
        onClose={() => setReviewingDoc(null)}
        shipmentId={shipmentId}
        summary={reviewingDoc}
      />

      {selectedPdfDoc && (
        <Modal
          isOpen={!!selectedPdfDoc}
          titleId="pdf-doc-viewer-modal-title"
          onClose={() => setSelectedPdfDoc(null)}
          size="xl"
        >
          <div className="p-0 min-h-[720px] h-[88vh] flex flex-col overflow-hidden">
            <DocumentReviewPanel
              documentId={selectedPdfDoc.documentId}
              fileName={selectedPdfDoc.fileName}
              proxyUrl={documentViewUrl(selectedPdfDoc.documentId)}
              onClose={() => setSelectedPdfDoc(null)}
              titleId="pdf-doc-viewer-modal-title"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
