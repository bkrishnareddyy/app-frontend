"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DocumentReviewPanel, type DocumentReviewPanelProps } from "@/components/DocumentReviewPanel";

interface RawExtractionModalProps extends Omit<DocumentReviewPanelProps, "onClose" | "titleId" | "headerRight"> {
  isOpen: boolean;
  onClose: () => void;
}

const TITLE_ID = "raw-extraction-title";

export function RawExtractionModal({ isOpen, onClose, fileName, ...panelProps }: RawExtractionModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId={TITLE_ID}
      size="lg"
      className="max-h-[90vh] flex flex-col space-y-0"
    >
      <DocumentReviewPanel {...panelProps} fileName={fileName} onClose={onClose} titleId={TITLE_ID} />

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border shrink-0 text-xs">
        <span className="text-ink-muted">
          Source File: <strong>{fileName}</strong>
        </span>
        <Button onClick={onClose} size="sm">
          Close Viewer
        </Button>
      </div>
    </Modal>
  );
}
