"use client";

import { useState } from "react";
import { Code, ExternalLink } from "lucide-react";
import { RawExtractionModal } from "./RawExtractionModal";

interface DocumentViewerControlsProps {
  documentId: string;
  fileName: string;
  fileUrl?: string | null;
  proxyUrl: string;
  shipmentNumber?: string;
}

export function DocumentViewerControls({
  documentId,
  fileName,
  fileUrl,
  proxyUrl,
  shipmentNumber,
}: DocumentViewerControlsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-center space-x-2 shrink-0">
        {fileUrl && (
          <a
            href={proxyUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1 rounded-lg bg-[#0071E3] hover:bg-[#0077ED] text-white font-bold text-xs inline-flex items-center space-x-1 transition-colors"
          >
            <span>Open PDF in Tab</span>
          </a>
        )}

        <button
          onClick={() => setIsModalOpen(true)}
          className="px-3 py-1 rounded-lg bg-[#F5F5F7] hover:bg-[#E5E5EA] border border-[#E5E5EA] text-[#1D1D1F] font-bold text-xs inline-flex items-center space-x-1.5 transition-colors cursor-pointer"
          title="View raw extracted JSON blob and key-value pairs"
        >
          <Code className="w-3.5 h-3.5 text-[#0071E3]" />
          <span>View Raw Extraction (JSON)</span>
        </button>
      </div>

      <RawExtractionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        documentId={documentId}
        fileName={fileName}
        shipmentNumber={shipmentNumber}
      />
    </>
  );
}
