"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Plus, Unlink, Loader2, X, Files } from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  selectedDocId?: string;
}

const DETACH_TITLE_ID = "detach-document-title";

export function ShipmentDocumentsSection({
  shipmentId,
  documents: initialDocs,
  originStatus = "Not Applicable",
}: ShipmentDocumentsSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeDocId = searchParams.get("docId") || initialDocs[0]?.id;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [docPendingDetach, setDocPendingDetach] = useState<{ id: string; fileName: string } | null>(null);

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

  const isDocReceived = (d: DocumentItem) =>
    d.status !== "Missing" &&
    Boolean(d.fileUrl || d.status === "Received" || d.status === "Processed" || d.status === "Review Required" || d.status === "Completed");

  const { receivedCount, totalRequired } = checkRequiredDocumentTypes(
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
          <Button
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="rounded-xl py-1.5 gap-1 shrink-0 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Document</span>
          </Button>
        </div>

        <div className="space-y-2">
          {documents.map((doc) => {
            const received = isDocReceived(doc);
            const isSelected = activeDocId === doc.id;
            
            return (
              <Link
                key={doc.id}
                href={`?docId=${doc.id}`}
                className={`p-3 rounded-xl block border flex items-center justify-between text-xs transition-colors hover:border-brand ${
                  isSelected
                    ? "bg-blue-50/50 border-brand shadow-2xs"
                    : "bg-surface-muted border-border"
                }`}
              >
                <div className="flex items-start space-x-2.5 min-w-0 pr-2">
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
              </Link>
            );
          })}
        </div>

        {/* Missing-required-document actions now live in the unified
            Exceptions panel at the top of the page, not duplicated here. */}
        <p className="text-[11px] text-ink-muted px-1">
          {receivedCount}/{totalRequired} required document types on file
        </p>
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
