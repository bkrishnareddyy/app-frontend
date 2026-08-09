"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Plus, Upload, FileText } from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface DocumentItem {
  id: string;
  docType: string;
  fileName: string;
  pageCount: number;
  confidence: number;
  status: string;
  fileUrl?: string | null;
}

interface ShipmentDocumentsSectionProps {
  shipmentId: string;
  documents: DocumentItem[];
  originStatus?: string;
}

export function ShipmentDocumentsSection({
  shipmentId,
  documents: initialDocs,
  originStatus = "Not Applicable",
}: ShipmentDocumentsSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeDocId = searchParams.get("docId") || initialDocs[0]?.id;
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    setDocuments(Array.from(new Map(initialDocs.map((d) => [d.id, d])).values()));
  }, [initialDocs]);

  const requiredTypes = ["Commercial Invoice", "Packing List", "Bill of Lading"];
  if (originStatus !== "Not Applicable") {
    requiredTypes.push("Certificate of Origin");
  }

  const isDocReceived = (d: DocumentItem) =>
    d.status !== "Missing" &&
    Boolean(d.fileUrl || d.status === "Received" || d.status === "Processed" || d.status === "Review Required" || d.status === "Completed");

  const satisfiedTypes = requiredTypes.filter(req => {
    return documents.some(d => {
      if (!isDocReceived(d)) return false;
      const type = (d.docType || "").toLowerCase();
      const name = (d.fileName || "").toLowerCase();
      
      if (req === "Commercial Invoice") {
        return type.includes("invoice") || name.includes("invoice");
      }
      if (req === "Packing List") {
        return type.includes("packing") || name.includes("packing");
      }
      if (req === "Bill of Lading") {
        return type.includes("lading") || type.includes("transport") || name.includes("lading") || name.includes("instructions") || name.includes("waybill");
      }
      if (req === "Certificate of Origin") {
        return type.includes("origin") || type.includes("coo") || name.includes("origin") || name.includes("coo");
      }
      return false;
    });
  });

  const receivedCount = satisfiedTypes.length;
  const totalRequired = requiredTypes.length;
  const missingCount = totalRequired - receivedCount;
  const missingTypes = requiredTypes.filter(req => !satisfiedTypes.includes(req));

  return (
    <>
      <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F] shrink-0">
            DOCUMENTS ({receivedCount}/{totalRequired})
          </h3>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Document</span>
          </button>
        </div>

        <div className="space-y-2">
          {documents.map((doc) => {
            const received = isDocReceived(doc);
            const isSelected = activeDocId === doc.id;
            
            return (
              <Link
                key={doc.id}
                href={`?docId=${doc.id}`}
                className={`p-3 rounded-xl block border flex items-center justify-between text-xs transition-colors hover:border-[#0071E3] ${
                  isSelected 
                    ? "bg-blue-50/50 border-[#0071E3] shadow-2xs" 
                    : "bg-[#F5F5F7] border-[#E5E5EA]"
                }`}
              >
                <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                  {received ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-[#1D1D1F] truncate">{doc.docType}</p>
                    <p className="text-[10px] text-[#86868B] truncate">
                      {doc.fileName} ({doc.pageCount || 1} pages)
                    </p>
                  </div>
                </div>
                {received ? (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 shrink-0">
                    {doc.confidence || 95}% Parsed
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 shrink-0">
                    Missing
                  </span>
                )}
              </Link>
            );
          })}
        </div>


        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800 space-y-1">
          <p className="font-bold">Document Set Summary</p>
          <p className="text-[11px] text-blue-600">
            Authoritative required documents received: {receivedCount}/{totalRequired}
          </p>
          {missingCount > 0 ? (
            <p className="text-[11px] text-red-600 font-semibold">
              Missing required: {missingTypes.join(", ")}
            </p>
          ) : (
            <p className="text-[11px] text-emerald-600 font-semibold">
              ✓ All required trade documents received
            </p>
          )}
        </div>
      </div>

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
