"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, Plus, Upload, FileText } from "lucide-react";
import { DocumentUploadModal } from "@/components/DocumentUploadModal";

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
}

export function ShipmentDocumentsSection({
  shipmentId,
  documents: initialDocs,
}: ShipmentDocumentsSectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>(initialDocs);

  const receivedCount = documents.filter((d) => d.status === "Received").length;
  const missingCount = documents.filter((d) => d.status === "Missing").length;

  return (
    <>
      <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F] shrink-0">
            DOCUMENTS ({receivedCount}/{documents.length})
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
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between text-xs hover:border-[#0071E3] transition-colors"
            >
              <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                {doc.status === "Received" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-bold text-[#1D1D1F] truncate">{doc.docType}</p>
                  <p className="text-[10px] text-[#86868B] truncate">
                    {doc.fileName} ({doc.pageCount} pages)
                  </p>
                </div>
              </div>
              {doc.status === "Received" ? (
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                  {doc.confidence}%
                </span>
              ) : (
                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 shrink-0">
                  Missing
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800 space-y-1">
          <p className="font-bold">Document Set Summary</p>
          <p className="text-[11px] text-blue-600">
            All documents classified: {receivedCount}/{documents.length}
          </p>
          {missingCount > 0 ? (
            <p className="text-[11px] text-red-600 font-semibold">
              Missing documents: {missingCount} (Certificate of Origin)
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
          // Re-fetch or reload
        }}
      />
    </>
  );
}
