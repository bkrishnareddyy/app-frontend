"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";
import { AWAITING_PROCESSING } from "@/lib/honest";

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

  // Derived from props rather than seeded into state, so a refresh of the
  // parent is actually reflected here.
  const documents = Array.from(new Map(initialDocs.map((d) => [d.id, d])).values());

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
            className="px-3 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-semibold rounded-xl shadow-xs transition-all flex items-center space-x-1 shrink-0 whitespace-nowrap cursor-pointer"
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
              <div
                key={doc.id}
                className={`p-3 rounded-xl border text-sm transition-colors hover:border-[#0071E3] space-y-2 ${
                  isSelected
                    ? "bg-blue-50/50 border-[#0071E3] shadow-2xs"
                    : "bg-[#F5F5F7] border-[#E5E5EA]"
                }`}
              >
                <Link
                  href={`?docId=${doc.id}`}
                  aria-current={isSelected ? "true" : undefined}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                    {received ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-[#1D1D1F] truncate">
                        {doc.docType === "AUTO_DETECT" ? "Type not detected" : doc.docType}
                      </p>
                      <p className="text-sm text-[#86868B] truncate">
                        {doc.fileName}
                        {doc.pageCount !== null && ` (${doc.pageCount} pages)`}
                      </p>
                    </div>
                  </div>
                  {received ? (
                    <span
                      className="text-sm font-bold text-[#1D1D1F] bg-white px-2.5 py-0.5 rounded-full border border-[#E5E5EA] shrink-0"
                      title="Model confidence, not legal certainty"
                    >
                      {doc.confidence === null
                        ? AWAITING_PROCESSING
                        : `Model ${doc.confidence}%`}
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 shrink-0">
                      Missing
                    </span>
                  )}
                </Link>
                {received && (
                  <Link
                    href={`/app/documents/${doc.id}/review`}
                    className="inline-block text-sm font-semibold text-[#0071E3] hover:underline"
                  >
                    Review extracted fields
                  </Link>
                )}
              </div>
            );
          })}
        </div>


        <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] text-sm text-[#1D1D1F] space-y-1">
          <p className="font-bold">Document set</p>
          <p className="text-sm text-[#6E6E73]">
            {receivedCount} of {totalRequired} required document types have a stored file.
          </p>
          {missingCount > 0 ? (
            <p className="text-sm text-red-700 font-semibold">
              Missing required: {missingTypes.join(", ")}
            </p>
          ) : (
            <p className="text-sm text-emerald-700 font-semibold">
              All required trade documents received
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
