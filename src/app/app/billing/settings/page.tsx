import React from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { saveCostProfileAction } from "./actions";

export const revalidate = 0;

export default async function BillingSettingsPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.cost.view"))) redirect("/app/billing");

  const profile = await db.costProfile.findFirst({
    where: { accountId: ctx.accountId },
    orderBy: { effectiveDate: "desc" },
  });

  const loadedLaborRate = profile ? Number(profile.loadedLaborRate) : 72.0;
  const aiTokenRate = profile ? Number(profile.aiTokenRate) : 0.00015;
  const ocrPageRate = profile ? Number(profile.ocrPageRate) : 0.05;
  const aceFee = profile ? Number(profile.aceTransmissionFee) : 0.25;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-ink">Costing Profiles & Internal Rates</h2>
        <p className="text-sm text-ink-muted">Configure loaded labor rates and technology unit-cost defaults for this brokerage account. Saving creates a new effective-dated profile so historical cost assumptions remain traceable.</p>
      </div>

      <form action={saveCostProfileAction} className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <h3 className="text-base font-bold text-ink border-b border-[#E5E5EA] pb-3">Brokerage Loaded Labor & Technology Cost Parameters</h3>

        <div>
          <label className="text-xs font-semibold text-ink uppercase tracking-wider">Profile Name</label>
          <input name="name" type="text" defaultValue={profile?.name ?? "Default Cost Profile"} required className="mt-2 w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink text-sm focus:outline-none focus:border-brand" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">Loaded Broker Hourly Rate ($/hr)</label>
            <input name="loadedLaborRate" type="number" min="0" step="0.01" defaultValue={loadedLaborRate} required className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand" />
            <p className="text-[11px] text-ink-muted">Internal labor cost for manual classifications, overrides, document reviews, and exception work.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">AI Token Rate ($ per 1k tokens)</label>
            <input name="aiTokenRate" type="number" min="0" step="0.00001" defaultValue={aiTokenRate} required className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand" />
            <p className="text-[11px] text-ink-muted">Internal API cost assumption for AI classification and document extraction inference.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">OCR Page Processing Rate ($/page)</label>
            <input name="ocrPageRate" type="number" min="0" step="0.01" defaultValue={ocrPageRate} required className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand" />
            <p className="text-[11px] text-ink-muted">Internal technology cost for OCR document ingestion per page.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">ACE Transmission Gateway Fee ($/submission)</label>
            <input name="aceTransmissionFee" type="number" min="0" step="0.01" defaultValue={aceFee} required className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand" />
            <p className="text-[11px] text-ink-muted">Configured external network/gateway cost per transmitted customs entry.</p>
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E5EA] flex items-center justify-between">
          <div className="text-xs text-ink-muted">Current effective profile: {profile ? `${profile.name} • ${new Date(profile.effectiveDate).toLocaleDateString()}` : "No saved profile"}</div>
          <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm">Save New Cost Profile</button>
        </div>
      </form>
    </div>
  );
}
