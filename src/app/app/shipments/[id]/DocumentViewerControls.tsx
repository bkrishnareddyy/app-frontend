"use client";

import { useState } from "react";
import { RawExtractionModal } from "@/components/RawExtractionModal";

interface DocumentViewerControlsProps {
  documentId: string;
  fileName: string;
  fileUrl?: string | null;
  proxyUrl: string;
  shipmentNumber?: string;
  children: React.ReactNode;
}

export function DocumentViewerControls({
  documentId,
  fileName,
  fileUrl,
  proxyUrl,
  shipmentNumber,
  children,
}: DocumentViewerControlsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className="cursor-pointer group flex items-center min-w-0"
        title="Click to view extraction preview, key-value pairs, and JSON data"
      >
        {children}
      </div>

      <RawExtractionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        documentId={documentId}
        fileName={fileName}
        shipmentNumber={shipmentNumber}
        fileUrl={fileUrl}
        proxyUrl={proxyUrl}
      />
    </>
  );
}
