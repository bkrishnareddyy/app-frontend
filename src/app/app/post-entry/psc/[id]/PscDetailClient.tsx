"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ReceiptText,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  RotateCcw,
  FileCheck,
  Edit2,
  Save,
  XCircle,
  FileText,
} from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface PscDetail {
  id: string;
  originalFilingId: string;
  correctionType: string;
  originalDutyAmount: number;
  correctedDutyAmount: number;
  dutyDelta: number | null;
  refundAmount: number;
  interestEstimate: number | null;
  status: string;
  reason: string;
  legalBasis: string | null;
  correctedHtsCode: string | null;
  notes: string | null;
  filedAt: string | null;
  createdAt: string;
  originalFiling: {
    entryNumber: string;
    filingStatus: string;
    totalValue: number | null;
    shipment: {
      shipmentNumber: string;
      complianceDeadlines?: Array<{ dueAt: string | null }>;
    };
  };
  Attachments?: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    uploadedAt: string;
  }>;
}

export function PscDetailClient({ pscId }: { pscId: string }) {
  const router = useRouter();
  const [psc, setPsc] = useState<PscDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [legalBasis, setLegalBasis] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Action states
  const [actionProcessing, setActionProcessing] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  const loadPsc = useCallback(() => {
    setLoading(true);
    fetch(`/api/refunds/psc/${pscId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.psc) {
          setPsc(d.psc);
          setLegalBasis(d.psc.legalBasis || "");
          setReason(d.psc.reason || "");
          setNotes(d.psc.notes || "");
        } else {
          setError(d.error || "PSC not found");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [pscId]);

  useEffect(() => {
    loadPsc();
  }, [loadPsc]);

  const handleSaveEdit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/refunds/psc/${pscId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalBasis, reason, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update PSC");
      setPsc(data.psc);
      setIsEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkReady = async () => {
    setActionProcessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/refunds/psc/${pscId}/ready`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to mark ready");
      loadPsc();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionProcessing(false);
    }
  };

  const handleSubmitAce = async () => {
    if (!confirm("Are you sure you want to transmit this Post-Summary Correction to CBP ACE?")) return;
    setActionProcessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/refunds/psc/${pscId}/submit`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to submit PSC");
      loadPsc();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawReason.trim()) {
      alert("Please provide a reason for withdrawal.");
      return;
    }
    setActionProcessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/refunds/psc/${pscId}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: withdrawReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to withdraw PSC");
      setShowWithdrawModal(false);
      loadPsc();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionProcessing(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-ink-muted">Loading PSC details...</div>;
  }

  if (error || !psc) {
    return (
      <div className="p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="font-bold text-ink">{error || "PSC not found"}</p>
        <Link href="/app/post-entry/psc" className="mt-4 inline-block text-brand text-sm font-medium">
          ← Back to PSC list
        </Link>
      </div>
    );
  }

  const daysLeft = psc.originalFiling?.shipment?.complianceDeadlines?.[0]?.dueAt
    ? Math.max(
        0,
        Math.floor(
          (new Date(psc.originalFiling.shipment.complianceDeadlines[0].dueAt).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : null;

  const delta = psc.dutyDelta ?? psc.correctedDutyAmount - psc.originalDutyAmount;

  return (
    <div className="min-h-screen bg-surface-muted pb-12">
      {/* Header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <Link href="/app/post-entry" className="hover:text-brand transition-colors">Post-Entry</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/app/post-entry/psc" className="hover:text-brand transition-colors">Post-Summary Corrections</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">PSC #{psc.id.slice(-6)}</span>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link
              href="/app/post-entry/psc"
              className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-ink tracking-tight">
                  PSC for Entry #{psc.originalFiling?.entryNumber}
                </h1>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-violet-100 text-violet-800">
                  {psc.status}
                </span>
              </div>
              <p className="text-sm text-ink-muted mt-0.5">
                Shipment: {psc.originalFiling?.shipment?.shipmentNumber} • Created {new Date(psc.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {psc.status === "Draft" && (
              <>
                <button
                  onClick={handleMarkReady}
                  disabled={actionProcessing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <FileCheck className="w-4 h-4" /> Mark Ready for Review
                </button>
              </>
            )}

            {psc.status === "READY_FOR_REVIEW" && (
              <button
                onClick={handleSubmitAce}
                disabled={actionProcessing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> Submit to CBP ACE
              </button>
            )}

            {!["ACE_ACCEPTED", "WITHDRAWN"].includes(psc.status) && (
              <button
                onClick={() => setShowWithdrawModal(true)}
                disabled={actionProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-white text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" /> Withdraw
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main detail content */}
      <div className="max-w-5xl mx-auto px-6 pt-8 space-y-6">
        {/* Banner if urgent */}
        {daysLeft !== null && daysLeft <= 7 && !["SUBMITTED", "ACE_ACCEPTED", "WITHDRAWN"].includes(psc.status) && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-800 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            270-day window expires in {daysLeft} days! Ensure review and ACE submission are finalized promptly.
          </div>
        )}

        {/* Financial Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Original Duty Paid</p>
            <p className="text-lg font-bold font-mono text-ink mt-1">{displayCurrency(psc.originalDutyAmount)}</p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Corrected Duty</p>
            <p className="text-lg font-bold font-mono text-ink mt-1">{displayCurrency(psc.correctedDutyAmount)}</p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Duty Delta / Exposure</p>
            <p className={`text-lg font-bold font-mono mt-1 ${delta > 0 ? "text-red-600" : delta < 0 ? "text-emerald-600" : "text-ink"}`}>
              {delta > 0 ? `+${displayCurrency(delta)}` : displayCurrency(delta)}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-xs font-medium text-ink-muted">Window Countdown</p>
            <p className="text-lg font-bold text-ink mt-1 flex items-center gap-1">
              <Clock className="w-4 h-4 text-ink-muted" />
              {daysLeft !== null ? `${daysLeft} days left` : "N/A"}
            </p>
          </div>
        </div>

        {/* Details Card */}
        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <h2 className="text-base font-bold text-ink">Correction Specifications</h2>
            {psc.status === "Draft" && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit Fields
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-muted">Correction Type</p>
                <p className="text-sm font-medium text-ink mt-0.5">{psc.correctionType}</p>
              </div>
              {psc.correctedHtsCode && (
                <div>
                  <p className="text-xs font-semibold uppercase text-ink-muted">Corrected HTS Code</p>
                  <p className="text-sm font-mono font-medium text-ink mt-0.5">{psc.correctedHtsCode}</p>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-ink-muted">Reason for Correction</p>
              {isEditing ? (
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3 py-2 mt-1"
                />
              ) : (
                <p className="text-sm text-ink mt-0.5 leading-relaxed">{psc.reason}</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-ink-muted">Legal & Regulatory Basis</p>
              {isEditing ? (
                <textarea
                  rows={3}
                  value={legalBasis}
                  onChange={(e) => setLegalBasis(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3 py-2 mt-1"
                />
              ) : (
                <p className="text-sm text-ink mt-0.5 leading-relaxed whitespace-pre-wrap">
                  {psc.legalBasis || <span className="text-ink-muted italic">No legal basis documented yet.</span>}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-ink-muted">Broker Internal Notes</p>
              {isEditing ? (
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3 py-2 mt-1"
                />
              ) : (
                <p className="text-sm text-ink mt-0.5 leading-relaxed">
                  {psc.notes || <span className="text-ink-muted italic">None</span>}
                </p>
              )}
            </div>

            {isEditing && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold"
                >
                  <Save className="w-3.5 h-3.5" /> Save Changes
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl border border-border text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal for Withdrawal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-ink">Withdraw Post-Summary Correction</h3>
            <p className="text-sm text-ink-muted">
              Please state why this PSC is being withdrawn. This will be logged in the permanent audit trail.
            </p>
            <textarea
              rows={3}
              placeholder="Reason for withdrawal..."
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              className="w-full text-sm border border-border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowWithdrawModal(false)}
                className="px-4 py-2 rounded-xl border border-border text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleWithdraw}
                disabled={actionProcessing}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
              >
                Confirm Withdrawal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
