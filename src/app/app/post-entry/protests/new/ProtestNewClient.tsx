"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Scale, ChevronRight, ArrowLeft, ShieldCheck, AlertCircle } from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface EligibleEntry {
  id: string;
  entryNumber: string;
  shipmentNumber: string;
  importerName: string | null;
  totalDuties: number | null;
  liquidationDate: string;
  protestDeadline: string;
  daysRemaining: number;
  urgent: boolean;
}

export function ProtestNewClient() {
  const router = useRouter();
  const [eligibleEntries, setEligibleEntries] = useState<EligibleEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  // Form states
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [groundsCode, setGroundsCode] = useState("CLASSIFICATION");
  const [groundsNarrative, setGroundsNarrative] = useState("");
  const [statuteCitation, setStatuteCitation] = useState("");
  const [rulingReference, setRulingReference] = useState("");
  const [claimAmount, setClaimAmount] = useState<string>("");
  const [interestClaimed, setInterestClaimed] = useState(false);
  const [powerOfAttorneyVerified, setPowerOfAttorneyVerified] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/protests/eligible-entries")
      .then((r) => r.json())
      .then((data) => {
        if (data.eligible) setEligibleEntries(data.eligible);
      })
      .catch(console.error)
      .finally(() => setLoadingEntries(false));
  }, []);

  const toggleEntrySelection = (entry: EligibleEntry) => {
    if (selectedEntryIds.includes(entry.id)) {
      setSelectedEntryIds(selectedEntryIds.filter((id) => id !== entry.id));
    } else {
      setSelectedEntryIds([...selectedEntryIds, entry.id]);
      if (claimAmount === "" && entry.totalDuties) {
        setClaimAmount(String(entry.totalDuties));
      }
    }
  };

  const selectedEntries = eligibleEntries.filter((e) => selectedEntryIds.includes(e.id));
  const minLiquidationDate = selectedEntries.length > 0
    ? selectedEntries.reduce((min, e) => (e.liquidationDate < min ? e.liquidationDate : min), selectedEntries[0].liquidationDate)
    : new Date().toISOString();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEntryIds.length === 0) {
      setError("Please select at least one liquidated entry summary to protest.");
      return;
    }
    if (groundsNarrative.trim().length < 100) {
      setError("Grounds narrative must be at least 100 characters to form a valid legal protest under 19 U.S.C. § 1514.");
      return;
    }
    if (!claimAmount || Number(claimAmount) <= 0) {
      setError("Please enter a valid positive claim amount.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/protests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          liquidationDate: minLiquidationDate,
          groundsCode,
          groundsNarrative,
          statuteCitation: statuteCitation || undefined,
          rulingReference: rulingReference || undefined,
          claimAmount: Number(claimAmount),
          interestClaimed,
          entries: selectedEntries.map((e) => ({
            filingId: e.id,
            entryNumber: e.entryNumber,
            liquidationDate: e.liquidationDate,
            dutyAssessed: e.totalDuties ?? 0,
            dutyContested: e.totalDuties ?? 0,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to create Protest");
      }

      // If POA is checked, update it in the created protest
      if (powerOfAttorneyVerified && data.protest?.id) {
        await fetch(`/api/protests/${data.protest.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ powerOfAttorneyVerified: true }),
        });
      }

      router.push(`/app/post-entry/protests/${data.protest.id}`);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-muted pb-12">
      {/* Top Header */}
      <div className="border-b border-border bg-white/70 backdrop-blur-sm px-6 py-5">
        <div className="flex items-center gap-2 text-ink-muted text-sm mb-1">
          <Link href="/app/post-entry" className="hover:text-brand transition-colors">Post-Entry</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/app/post-entry/protests" className="hover:text-brand transition-colors">Protests</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink font-medium">New Protest (Form 19)</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/post-entry/protests"
            className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">Draft Form 19 Protest</h1>
            <p className="text-sm text-ink-muted">
              Prepare a statutory protest against CBP liquidation under 19 U.S.C. § 1514 (180-day window).
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pt-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-sm">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Filing Error</p>
              <p className="mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Select Liquidated Entries */}
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-ink mb-1 flex items-center gap-2">
              <Scale className="w-4 h-4 text-brand" />
              1. Select Covered Liquidated Entries *
            </h2>
            <p className="text-xs text-ink-muted mb-4">
              Select one or more entries sharing the same legal challenge within 180 days of liquidation.
            </p>

            {loadingEntries ? (
              <div className="text-sm text-ink-muted py-4">Loading eligible liquidated entries...</div>
            ) : eligibleEntries.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">
                No liquidated entries currently eligible for protest. Protests require entries that have reached Released or Closed (liquidated) status within the last 180 days.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {eligibleEntries.map((entry) => {
                  const checked = selectedEntryIds.includes(entry.id);
                  return (
                    <div
                      key={entry.id}
                      onClick={() => toggleEntrySelection(entry)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        checked ? "border-brand bg-brand/5 shadow-xs" : "border-border hover:border-brand/40 bg-white"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {}} // handled by div click
                            className="rounded text-brand focus:ring-brand/30"
                          />
                          <span className="font-mono text-sm font-bold text-ink">Entry #{entry.entryNumber}</span>
                          <span className="text-xs text-ink-muted">({entry.shipmentNumber})</span>
                        </div>
                        <p className="text-xs text-ink-muted mt-1 ml-5">
                          Liquidated: {new Date(entry.liquidationDate).toLocaleDateString()} • {entry.daysRemaining} days left in window
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-ink">{displayCurrency(entry.totalDuties ?? 0)}</p>
                        <p className="text-xs text-ink-muted">Assessed Duty</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Grounds of Protest */}
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-ink">2. Legal Grounds & Citation</h2>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                Primary Grounds of Protest *
              </label>
              <select
                value={groundsCode}
                onChange={(e) => setGroundsCode(e.target.value)}
                required
                className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="CLASSIFICATION">Classification Error (HTS Tariff Heading/Subheading)</option>
                <option value="VALUATION">Valuation Error (Appraisement / Deductions under 19 U.S.C. § 1401a)</option>
                <option value="ORIGIN">Country of Origin / Marking Determination</option>
                <option value="RATE_OF_DUTY">Rate of Duty / Special Trade Program (USMCA, FTA)</option>
                <option value="EXCLUSION_ELIGIBILITY">Section 301 / Section 232 Exclusion Eligibility</option>
                <option value="LIQUIDATION_ERRORS">CBP Mathematical or Clerical Error at Liquidation</option>
                <option value="DRAWBACK_DENIAL">Challenge to CBP Drawback Denial</option>
                <option value="OTHER">Other Specific Regulatory Challenge</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Statute Citation (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 19 U.S.C. § 1514(a)(2)"
                  value={statuteCitation}
                  onChange={(e) => setStatuteCitation(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  CBP Ruling / Precedent (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. CROSS Ruling HQ H301234"
                  value={rulingReference}
                  onChange={(e) => setRulingReference(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                Detailed Grounds Narrative * (Minimum 100 characters)
              </label>
              <textarea
                rows={4}
                required
                placeholder="State the full legal argument, facts, and tariff classification or valuation principles supporting this protest..."
                value={groundsNarrative}
                onChange={(e) => setGroundsNarrative(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <p className="text-xs text-ink-muted text-right mt-1">
                {groundsNarrative.length} / 100 characters minimum
              </p>
            </div>
          </div>

          {/* Section 3: Financial Claim & Authorization */}
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-ink">3. Claim & Power of Attorney</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Contested Claim Amount ($) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={claimAmount}
                  onChange={(e) => setClaimAmount(e.target.value)}
                  className="w-full text-sm border border-border rounded-xl px-3.5 py-2.5 bg-white text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>

              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={interestClaimed}
                    onChange={(e) => setInterestClaimed(e.target.checked)}
                    className="rounded text-brand focus:ring-brand/30"
                  />
                  <span>Claim statutory interest under 19 U.S.C. § 1505</span>
                </label>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={powerOfAttorneyVerified}
                  onChange={(e) => setPowerOfAttorneyVerified(e.target.checked)}
                  className="rounded text-brand focus:ring-brand/30 mt-0.5"
                />
                <div className="text-xs leading-relaxed text-slate-700">
                  <span className="font-bold text-slate-900 block text-sm mb-0.5">
                    Power of Attorney (POA) Verification
                  </span>
                  I confirm that a valid, active Power of Attorney is on file authorizing our brokerage firm to execute and file CBP Form 19 protests on behalf of the importer of record.
                </div>
              </label>
            </div>
          </div>

          {/* Form Submit buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href="/app/post-entry/protests"
              className="px-5 py-2.5 rounded-xl border border-border bg-white text-ink text-sm font-semibold hover:bg-surface-muted transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold shadow-sm hover:bg-brand/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving Draft..." : "Save Protest Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
