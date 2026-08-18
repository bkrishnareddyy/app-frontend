import React from "react";
import { db } from "@/lib/db";
import { DEFAULT_COST_PROFILE } from "@/lib/billing/costingEngine";

export const revalidate = 0;

export default async function BillingSettingsPage() {
  const profile = await db.costProfile.findFirst({
    orderBy: { createdAt: "desc" },
  });

  const loadedLaborRate = profile ? Number(profile.loadedLaborRate) : DEFAULT_COST_PROFILE.loadedLaborRate;
  const aiTokenRate = profile ? Number(profile.aiTokenRate) : DEFAULT_COST_PROFILE.aiTokenRate;
  const ocrPageRate = profile ? Number(profile.ocrPageRate) : DEFAULT_COST_PROFILE.ocrPageRate;
  const aceFee = profile ? Number(profile.aceTransmissionFee) : DEFAULT_COST_PROFILE.aceTransmissionFee;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-white">Costing Profiles & Internal Rates</h2>
        <p className="text-sm text-slate-400">
          Configure loaded labor rates for manual broker reviews and technology unit cost defaults.
        </p>
      </div>

      <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 space-y-6">
        <h3 className="text-base font-semibold text-white border-b border-slate-800 pb-3">
          Brokerage Loaded Labor & Technology Cost Parameters
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Loaded Broker Hourly Rate ($/hr)
            </label>
            <input
              type="number"
              defaultValue={loadedLaborRate}
              className="w-full px-3.5 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500">
              Used to compute internal labor cost for manual classifications, overrides, and document reviews.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              AI Token Rate ($ per 1k tokens)
            </label>
            <input
              type="number"
              step="0.00001"
              defaultValue={aiTokenRate}
              className="w-full px-3.5 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500">
              Internal API cost for LLM classification and document extraction inference.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              OCR Page Processing Rate ($/page)
            </label>
            <input
              type="number"
              step="0.01"
              defaultValue={ocrPageRate}
              className="w-full px-3.5 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500">
              Internal technology cost for OCR document ingestion per page.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              ACE Transmission Gateway Fee ($/submission)
            </label>
            <input
              type="number"
              step="0.05"
              defaultValue={aceFee}
              className="w-full px-3.5 py-2 rounded-md bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500">
              CBP EDI network gateway fee per transmitted customs entry.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
          >
            Save Costing Parameters
          </button>
        </div>
      </div>
    </div>
  );
}
