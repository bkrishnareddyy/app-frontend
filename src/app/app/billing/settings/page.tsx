import React from "react";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function BillingSettingsPage() {
  const profile = await db.costProfile.findFirst({
    orderBy: { createdAt: "desc" },
  });

  const loadedLaborRate = profile ? Number(profile.loadedLaborRate) : 72.0;
  const aiTokenRate = profile ? Number(profile.aiTokenRate) : 0.00015;
  const ocrPageRate = profile ? Number(profile.ocrPageRate) : 0.05;
  const aceFee = profile ? Number(profile.aceTransmissionFee) : 0.25;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-ink">Costing Profiles & Internal Rates</h2>
        <p className="text-sm text-ink-muted">
          Configure loaded labor rates for manual broker reviews and technology unit cost defaults.
        </p>
      </div>

      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <h3 className="text-base font-bold text-ink border-b border-[#E5E5EA] pb-3">
          Brokerage Loaded Labor & Technology Cost Parameters
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              Loaded Broker Hourly Rate ($/hr)
            </label>
            <input
              type="number"
              defaultValue={loadedLaborRate}
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand"
            />
            <p className="text-[11px] text-ink-muted">
              Used to compute internal labor cost for manual classifications, overrides, and document reviews.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              AI Token Rate ($ per 1k tokens)
            </label>
            <input
              type="number"
              step="0.00001"
              defaultValue={aiTokenRate}
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand"
            />
            <p className="text-[11px] text-ink-muted">
              Internal API cost for LLM classification and document extraction inference.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              OCR Page Processing Rate ($/page)
            </label>
            <input
              type="number"
              step="0.01"
              defaultValue={ocrPageRate}
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand"
            />
            <p className="text-[11px] text-ink-muted">
              Internal technology cost for OCR document ingestion per page.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              ACE Transmission Gateway Fee ($/submission)
            </label>
            <input
              type="number"
              step="0.05"
              defaultValue={aceFee}
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand"
            />
            <p className="text-[11px] text-ink-muted">
              CBP EDI network gateway fee per transmitted customs entry.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E5EA] flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm"
          >
            Save Costing Parameters
          </button>
        </div>
      </div>
    </div>
  );
}
