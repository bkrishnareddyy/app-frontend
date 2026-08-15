"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ReceiptText, ChevronRight, ArrowLeft, AlertCircle } from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface FilingOption {
  id: string;
  entryNumber: string;
  totalDuties: number | null;
  filingStatus: string;
}

export function PscNewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledFilingId = searchParams.get("filingId") || "";

  const [filings, setFilings] = useState<FilingOption[]>([]);
  const [loadingFilings, setLoadingFilings] = useState(true);

  const [originalFilingId, setOriginalFilingId] = useState(prefilledFilingId);
  const [correctionType, setCorrectionType] = useState("CLASSIFICATION_CORRECTION");
  const [reason, setReason] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [correctedDutyAmount, setCorrectedDutyAmount] = useState<string>("");
  const [correctedHtsCode, setCorrectedHtsCode] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch filings eligible for PSC (Accepted, Released, Liquidated)
    fetch("/api/filing?status=Accepted,Released,Liquidated")
      .then((res) => res.json())
      .then((data) => {
        if (data.filings) {
          setFilings(data.filings);
        } else {
          // fallback fetch without status filter if endpoint differs
          fetch("/api/filing")
            .then((r) => r.json())
            .then((d) => setFilings(d.filings ?? []));
        }
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => setLoadingFilings(false));
  }, []);

  const selectedFiling = filings.find((f) => f.id === originalFilingId);
  const originalDuty = selectedFiling?.totalDuties ? Number(selectedFiling.totalDuties) : 0;
  const correctedDuty = correctedDutyAmount !== "" ? Number(correctedDutyAmount) : originalDuty;
  const refundEst = Math.max(0, originalDuty - correctedDuty);
  const dutyDelta = correctedDuty - originalDuty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!originalFilingId) {
      setError("Please select an entry summary.");
      return;
    }
    if (correctedDutyAmount === "") {
      setError("Please enter the corrected duty amount.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/refunds/psc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalFilingId,
          correctionType,
          reason: reason || "Post-Summary Correction",
          legalBasis,
          originalDutyAmount: originalDuty,
          correctedDutyAmount: correctedDuty,
          correctedHtsCode: correctedHtsCode || undefined,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to create PSC");
      }

      router.push(`/app/post-entry/psc/${data.psc.id}`);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-muted pb-12">
      {/* Top Breadcrumb Header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <Link href="/app/post-entry" className="hover:text-brand transition-colors">Post-Entry</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/app/post-entry/psc" className="hover:text-brand transition-colors">Post-Summary Corrections</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">New Draft</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/post-entry/psc"
            className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">Create Post-Summary Correction</h1>
            <p className="text-sm text-ink-muted">
              Prepare a pre-liquidation amendment for CBP ACE entry summary.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pt-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-sm">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to create PSC</p>
              <p className="mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Entry Summary */}
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
              <ReceiptText className="w-4 h-4 text-brand" />
              1. Entry Summary & Correction Type
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Select Entry Summary *
                </label>
                {loadingFilings ? (
                  <div className="text-sm text-ink-muted">Loading entry summaries...</div>
                ) : (
                  <select
                    value={originalFilingId}
                    onChange={(e) => setOriginalFilingId(e.target.value)}
                    required
                    className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="">-- Choose an entry --</option>
                    {filings.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.entryNumber} (Status: {f.filingStatus} • Duty Paid: {displayCurrency(f.totalDuties ?? 0)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Correction Type *
                </label>
                <select
                  value={correctionType}
                  onChange={(e) => setCorrectionType(e.target.value)}
                  required
                  className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <option value="CLASSIFICATION_CORRECTION">Classification Correction (HTS)</option>
                  <option value="VALUE_CORRECTION">Valuation Correction (Entered Value)</option>
                  <option value="QUANTITY_CORRECTION">Quantity / Statistical Unit Error</option>
                  <option value="DUTY_RATE_CORRECTION">Duty Rate / Trade Preference Adjustment</option>
                </select>
              </div>

              {correctionType === "CLASSIFICATION_CORRECTION" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Corrected HTS Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 8471.30.0100"
                    value={correctedHtsCode}
                    onChange={(e) => setCorrectedHtsCode(e.target.value)}
                    className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 font-mono"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Financial Calculation */}
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-ink mb-4">2. Duty Calculations</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="p-3.5 rounded-xl bg-surface-muted border border-border">
                <p className="text-xs text-ink-muted font-medium">Original Duty Paid</p>
                <p className="text-lg font-bold font-mono text-ink mt-0.5">
                  {displayCurrency(originalDuty)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Corrected Duty Amount ($) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  value={correctedDutyAmount}
                  onChange={(e) => setCorrectedDutyAmount(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Calculated Impact</p>
                <p className="text-sm font-medium text-slate-800 mt-0.5">
                  {dutyDelta < 0
                    ? `Estimated Refund Claim: ${displayCurrency(refundEst)}`
                    : dutyDelta > 0
                    ? `Additional Duty Owed to CBP: ${displayCurrency(dutyDelta)}`
                    : "No net financial delta"}
                </p>
              </div>
              <span
                className={`text-sm font-mono font-bold px-3 py-1 rounded-full ${
                  dutyDelta < 0
                    ? "bg-emerald-100 text-emerald-800"
                    : dutyDelta > 0
                    ? "bg-red-100 text-red-800"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {dutyDelta > 0 ? `+${displayCurrency(dutyDelta)}` : displayCurrency(dutyDelta)}
              </span>
            </div>
          </div>

          {/* Section 3: Legal Basis & Reason */}
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-ink">3. Justification & Notes</h2>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                Reason for Correction
              </label>
              <input
                type="text"
                placeholder="e.g. Classification adjustment following CROSS ruling N12345"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                Legal Basis & Statutory Citation
              </label>
              <textarea
                rows={3}
                placeholder="Detail the legal justification under 19 U.S.C. / 19 CFR regulations, CBP ruling references, or contract terms..."
                value={legalBasis}
                onChange={(e) => setLegalBasis(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                Internal Broker Notes
              </label>
              <textarea
                rows={2}
                placeholder="Optional notes for your compliance team..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href="/app/post-entry/psc"
              className="px-5 py-2.5 rounded-xl border border-border bg-white text-ink text-sm font-semibold hover:bg-surface-muted transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold shadow-sm hover:bg-brand/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving Draft..." : "Create Draft PSC"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
