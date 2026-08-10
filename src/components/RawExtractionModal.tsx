"use client";

import { useDialogFocus, dialogSurfaceProps } from "@/lib/useDialogFocus";
import { DocumentReviewPanel, type DocumentReviewPanelProps } from "@/components/DocumentReviewPanel";

interface RawExtractionModalProps extends Omit<DocumentReviewPanelProps, "onClose" | "titleId" | "headerRight"> {
  isOpen: boolean;
  onClose: () => void;
}

const TITLE_ID = "raw-extraction-title";

export function RawExtractionModal({ isOpen, onClose, fileName, ...panelProps }: RawExtractionModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        {...dialogSurfaceProps(TITLE_ID)}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-4xl w-full p-6 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
      >
        <DocumentReviewPanel {...panelProps} fileName={fileName} onClose={onClose} titleId={TITLE_ID} />

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#E5E5EA] shrink-0 text-xs">
          <span className="text-[#86868B]">Source File: <strong>{fileName}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
}
