"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, FileText, Sparkles, Pencil } from "lucide-react";
import { Modal, ModalHeader, ModalBody } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { caughtMessage } from "@/lib/utils";

export interface FieldSummaryItem {
  key: string;
  label: string;
  value: string | null;
  status: "MISSING" | "CONFIRMED" | "NEEDS_REVIEW";
  approvedByName?: string;
  approvedAt?: string;
}

export interface DocumentFieldSummary {
  documentId: string;
  fileName: string;
  confirmedCount: number;
  totalCount: number;
  fields: FieldSummaryItem[];
}

interface DocumentFieldReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
  summary: DocumentFieldSummary | null;
}

const STATUS_VARIANTS: Record<FieldSummaryItem["status"], "danger" | "warning" | "success"> = {
  MISSING: "danger",
  NEEDS_REVIEW: "warning",
  CONFIRMED: "success",
};

const STATUS_LABELS: Record<FieldSummaryItem["status"], string> = {
  MISSING: "Missing",
  NEEDS_REVIEW: "Needs Review",
  CONFIRMED: "Confirmed",
};

const TITLE_ID = "document-field-review-title";

export function DocumentFieldReviewModal({ isOpen, onClose, shipmentId, summary }: DocumentFieldReviewModalProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !summary) return null;

  const submit = async (fieldKey: string, action: "APPROVE" | "EDIT", value: string) => {
    setError(null);
    setSavingKey(fieldKey);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/documents/${summary.documentId}/field-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, action, value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save field review");
      }
      // Record reviewer field correction audit event
      await fetch(`/api/documents/${summary.documentId}/extractions/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldPath: fieldKey, correctedValue: value, reason: `Reviewer ${action}` }),
      }).catch(() => null);

      window.location.reload();
    } catch (err) {
      setError(caughtMessage(err, "Failed to save field review"));
      setSavingKey(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId={TITLE_ID} className="max-w-xl space-y-4">
      <ModalHeader
        titleId={TITLE_ID}
        title={summary.fileName}
        subtitle="Expected fields from this document"
        icon={<FileText className="w-5 h-5" />}
        onClose={onClose}
      />

      {/* A document can expect many fields, so this list is what outgrows the
          viewport. It scrolls between the pinned header and the footnote below. */}
      <ModalBody className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          {summary.fields.map((field) => {
            const isEditing = editingKey === field.key;
            const isSaving = savingKey === field.key;

            return (
              <div key={field.key} className="p-4 rounded-xl bg-surface-muted border border-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-ink">{field.label}</span>
                  <Badge variant={STATUS_VARIANTS[field.status]} className="px-2 font-extrabold tracking-normal">
                    {STATUS_LABELS[field.status]}
                  </Badge>
                </div>

                {!isEditing ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {field.value ? (
                        <p className="text-sm font-mono font-bold text-ink truncate">{field.value}</p>
                      ) : (
                        <p className="text-xs text-ink-muted italic">Not found on document</p>
                      )}
                      {field.status === "CONFIRMED" && field.approvedByName && field.approvedAt && (
                        <p className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                          Approved by {field.approvedByName} · {new Date(field.approvedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      {field.status === "NEEDS_REVIEW" && (
                        <button
                          onClick={() => submit(field.key, "APPROVE", field.value || "")}
                          disabled={isSaving}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isSaving ? "Saving..." : "Approve"}</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setDraftValue(field.value || "");
                          setEditingKey(field.key);
                        }}
                        disabled={isSaving}
                        className="px-3 py-1.5 border border-border hover:bg-white text-ink text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>{field.value ? "Edit" : "Provide"}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={draftValue}
                      onChange={(e) => setDraftValue(e.target.value)}
                      placeholder={`Enter ${field.label}`}
                      autoFocus
                      className="w-full px-3.5 py-2.5 border border-brand rounded-xl outline-none font-mono font-bold bg-white text-[12px]"
                      disabled={isSaving}
                    />
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => setEditingKey(null)}
                        disabled={isSaving}
                        className="px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => submit(field.key, "EDIT", draftValue.trim())}
                        disabled={isSaving || !draftValue.trim()}
                        className="px-4 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </ModalBody>

      <div className="shrink-0 flex items-start space-x-2 text-[10px] text-ink-muted pt-2 border-t border-border">
        <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>These are the fields Qubere expects to find on this document. Approving confirms the extracted value is correct; editing corrects it.</span>
      </div>
    </Modal>
  );
}
