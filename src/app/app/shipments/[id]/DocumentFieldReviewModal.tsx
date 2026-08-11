"use client";

import { useState } from "react";
import { X, CheckCircle2, AlertTriangle, FileText, Sparkles, Pencil } from "lucide-react";
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

const STATUS_STYLES: Record<FieldSummaryItem["status"], string> = {
  MISSING: "bg-red-50 text-red-700 border-red-200",
  NEEDS_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STATUS_LABELS: Record<FieldSummaryItem["status"], string> = {
  MISSING: "Missing",
  NEEDS_REVIEW: "Needs Review",
  CONFIRMED: "Confirmed",
};

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
      window.location.reload();
    } catch (err) {
      setError(caughtMessage(err, "Failed to save field review"));
      setSavingKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-xl w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3] shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-[#1D1D1F] truncate">{summary.fileName}</h3>
              <p className="text-xs text-[#86868B]">Expected fields from this document</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
              <div key={field.key} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1D1D1F]">{field.label}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${STATUS_STYLES[field.status]}`}
                  >
                    {STATUS_LABELS[field.status]}
                  </span>
                </div>

                {!isEditing ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {field.value ? (
                        <p className="text-sm font-mono font-bold text-[#1D1D1F] truncate">{field.value}</p>
                      ) : (
                        <p className="text-xs text-[#86868B] italic">Not found on document</p>
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
                        className="px-3 py-1.5 border border-[#E5E5EA] hover:bg-white text-[#1D1D1F] text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
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
                      className="w-full px-3.5 py-2.5 border border-[#0071E3] rounded-xl outline-none font-mono font-bold bg-white text-[12px]"
                      disabled={isSaving}
                    />
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => setEditingKey(null)}
                        disabled={isSaving}
                        className="px-3 py-1.5 text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => submit(field.key, "EDIT", draftValue.trim())}
                        disabled={isSaving || !draftValue.trim()}
                        className="px-4 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
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

        <div className="flex items-start space-x-2 text-[10px] text-[#86868B] pt-2 border-t border-[#E5E5EA]">
          <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>These are the fields Qubere expects to find on this document. Approving confirms the extracted value is correct; editing corrects it.</span>
        </div>
      </div>
    </div>
  );
}
