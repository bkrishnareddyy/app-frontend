"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle2, AlertCircle, Plus, Unlink, Loader2, X, Files, Clock, XCircle, GripVertical, FileText } from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { checkRequiredDocumentTypes } from "@/lib/requiredDocumentTypes";
import { caughtMessage } from "@/lib/utils";

interface DocumentItem {
  id: string;
  docType: string;
  fileName: string;
  pageCount: number | null;
  confidence: number | null;
  status: string;
  fileUrl?: string | null;
}

interface ShipmentDocumentsSectionProps {
  shipmentId: string;
  documents: DocumentItem[];
  originStatus?: string;
  activeDocId: string | undefined;
  onSelectDoc: (docId: string) => void;
}

const DETACH_TITLE_ID = "detach-document-title";

// Standardized status display — maps raw DB status strings to a consistent
// label + colour so the workspace and the docs section always agree (A-1).
function docStatusChip(status: string, hasFileUrl: boolean) {
  const s = status.toLowerCase();
  if (s === "uploading" || s === "processing" || s === "pending") {
    return {
      label: "Processing",
      className: "text-blue-600 bg-blue-50 border-blue-200",
      icon: <Clock className="w-3 h-3" />,
    };
  }
  if (s === "processing_failed" || s === "failed" || s === "error") {
    return {
      label: "Failed",
      className: "text-red-600 bg-red-50 border-red-200",
      icon: <XCircle className="w-3 h-3" />,
    };
  }
  if (s === "needs_review" || s === "review required") {
    return {
      label: "Needs Review",
      className: "text-amber-600 bg-amber-50 border-amber-200",
      icon: <AlertCircle className="w-3 h-3" />,
    };
  }
  if (s === "archived") {
    return {
      label: "Archived",
      className: "text-slate-500 bg-slate-50 border-slate-200",
      icon: <XCircle className="w-3 h-3" />,
    };
  }
  if (s === "missing" || (!hasFileUrl && s !== "received" && s !== "processed" && s !== "completed" && s !== "ready")) {
    return {
      label: "Missing",
      className: "text-red-600 bg-red-50 border-red-200",
      icon: <AlertCircle className="w-3 h-3" />,
    };
  }
  // Ready / Received / Processed / Completed → green
  return {
    label: "Ready",
    className: "text-emerald-600 bg-emerald-50 border-emerald-200",
    icon: <CheckCircle2 className="w-3 h-3" />,
  };
}

export function ShipmentDocumentsSection({
  shipmentId,
  documents: initialDocs,
  originStatus = "Not Applicable",
  activeDocId,
  onSelectDoc,
}: ShipmentDocumentsSectionProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [docPendingDetach, setDocPendingDetach] = useState<{ id: string; fileName: string } | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const handleOpen = () => setIsModalOpen(true);
    window.addEventListener("qubere:open-upload-modal", handleOpen);
    return () => window.removeEventListener("qubere:open-upload-modal", handleOpen);
  }, []);

  // Map unique documents by ID to prevent key duplication while retaining all uploaded files
  const uniqueDocs = Array.from(
    new Map(initialDocs.map((d) => [d.id, d])).values()
  );

  const [documents, setDocuments] = useState<DocumentItem[]>(uniqueDocs);

  // Sync state when initialDocs props change (e.g. after dynamic file upload refresh)
  useEffect(() => {
    // Resyncs the list after an upload refreshes the server props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDocuments(Array.from(new Map(initialDocs.map((d) => [d.id, d])).values()));
  }, [initialDocs]);

  const requestDetach = (docId: string, fileName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDocPendingDetach({ id: docId, fileName });
  };

  const confirmDetach = async () => {
    if (!docPendingDetach) return;
    const { id: docId } = docPendingDetach;

    setDetachingId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/detach`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to detach document");
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      router.refresh();
    } catch (err) {
      alert(caughtMessage(err, "Failed to detach document"));
    } finally {
      setDetachingId(null);
      setDocPendingDetach(null);
    }
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDrop = async (dropIndex: number) => {
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || fromIndex === dropIndex) return;
    dragIndexRef.current = null;

    const reordered = [...documents];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setDocuments(reordered);

    try {
      await fetch(`/api/shipments/${shipmentId}/documents/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: reordered.map((d) => d.id) }),
      });
    } catch {
      setDocuments(documents);
    }
  };

  const isDocReceived = (d: DocumentItem) =>
    d.status !== "Missing" &&
    Boolean(d.fileUrl || d.status === "Received" || d.status === "Processed" || d.status === "Review Required" || d.status === "Completed");

  const { receivedCount, totalRequired, requiredTypes, missingTypes } = checkRequiredDocumentTypes(
    documents,
    originStatus !== "Not Applicable"
  );

  return (
    <>
      <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink min-w-0 break-words">
            DOCUMENTS ({documents.length} uploaded)
          </h3>
          <div className="flex items-center gap-2">
            <a
              href={`/api/audit/package/${shipmentId}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl border border-border bg-white hover:bg-surface-muted text-ink text-xs font-semibold transition-colors"
              title="Download compiled reasonable care audit PDF package"
            >
              <FileText className="w-3.5 h-3.5 text-brand" />
              <span>Audit PDF</span>
            </a>
            <Button
              size="sm"
              onClick={() => setIsModalOpen(true)}
              className="px-3 py-1 h-auto text-xs flex items-center space-x-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Upload Document</span>
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {documents.map((doc, idx) => {
            const received = isDocReceived(doc);
            const isSelected = activeDocId === doc.id;

            return (
              <div
                key={doc.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(idx)}
                role="button"
                tabIndex={0}
                onClick={() => onSelectDoc(doc.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectDoc(doc.id);
                  }
                }}
                className={`p-3 rounded-xl block border flex items-center justify-between text-xs transition-colors hover:border-brand cursor-pointer ${
                  isSelected
                    ? "bg-blue-50/50 border-brand shadow-2xs"
                    : "bg-surface-muted border-border"
                }`}
              >
                <div className="flex items-start space-x-2.5 min-w-0 pr-2">
                  <GripVertical className="w-3.5 h-3.5 text-ink-muted/40 shrink-0 mt-0.5 cursor-grab active:cursor-grabbing" />
                  {received ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-ink break-words">{doc.docType}</p>
                    <p className="text-[10px] text-ink-muted break-words">
                      {doc.fileName} ({doc.pageCount || 1} pages)
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-1.5 shrink-0">
                  {received ? (
                    doc.confidence !== null && doc.confidence !== undefined ? (
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                        {doc.confidence}% Parsed
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                        Uploaded
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                      Missing
                    </span>
                  )}
                  <button
                    onClick={(e) => requestDetach(doc.id, doc.fileName, e)}
                    disabled={detachingId === doc.id}
                    title="Detach from this shipment"
                    className="p-1 rounded-lg hover:bg-red-50 text-ink-muted hover:text-red-600 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {detachingId === doc.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Unlink className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Required documents checklist (A-2) */}
        <div className="pt-1 border-t border-border space-y-1.5">
          <p className="text-[10px] font-extrabold uppercase text-ink-muted tracking-wider">
            Required Documents — {receivedCount} of {totalRequired} on file
          </p>
          {requiredTypes.map((type) => {
            const present = !missingTypes.includes(type);
            return (
              <div key={type} className="flex items-center space-x-2 text-[11px]">
                {present ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                )}
                <span className={present ? "text-ink" : "text-red-600 font-semibold"}>
                  {type}
                  {!present && " ✗"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {docPendingDetach && (
        <Modal
          isOpen={Boolean(docPendingDetach)}
          onClose={() => setDocPendingDetach(null)}
          titleId={DETACH_TITLE_ID}
          closeDisabled={detachingId === docPendingDetach.id}
          className="max-w-md"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <Unlink className="w-4 h-4" />
              </div>
              <h3 id={DETACH_TITLE_ID} className="text-base font-extrabold text-ink">Detach Document</h3>
            </div>
            <button
              onClick={() => setDocPendingDetach(null)}
              className="p-1.5 rounded-full hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-ink truncate font-semibold">{docPendingDetach.fileName}</p>

          <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-start space-x-2">
            <Files className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <span>
              This will remove the document from this shipment. If you detach, you&apos;ll still find the document under{" "}
              <strong>Trade Documents</strong> as unattached, and can reattach it to any shipment later — nothing is deleted.
            </span>
          </div>

          <p className="text-xs text-ink-muted">Do you wish to continue?</p>

          <div className="flex items-center justify-end space-x-3 pt-1">
            <Button
              variant="secondary"
              onClick={() => setDocPendingDetach(null)}
              disabled={detachingId === docPendingDetach.id}
              className="shadow-none"
            >
              Cancel
            </Button>
            <button
              onClick={confirmDetach}
              disabled={detachingId === docPendingDetach.id}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-2 transition-all"
            >
              {detachingId === docPendingDetach.id ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Detaching...</span>
                </>
              ) : (
                <>
                  <Unlink className="w-4 h-4" />
                  <span>Detach Document</span>
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      <DocumentUploadModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        shipmentId={shipmentId}
        onUploadSuccess={() => {
          router.refresh();
        }}
      />
    </>
  );
}
