import React from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { detectRevenueLeakage } from "@/lib/billing/ledger";

export const revalidate = 0;

export default async function BillingExceptionsPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.reports.view"))) redirect("/app/billing");

  const exceptions = await db.billingException.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      shipment: { select: { shipmentNumber: true } },
    },
  });

  const leakageAlerts = await detectRevenueLeakage(ctx.accountId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Exceptions & Revenue Leakage Center</h2>
        <p className="text-sm text-ink-muted">Automated detection of missing rates, unbilled manual work, zero-rated events, and other billing anomalies.</p>
      </div>

      {leakageAlerts.length > 0 && (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
          <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />Revenue Leakage Alert: {leakageAlerts.length} Unbilled Manual Work Events Detected</h3>
          <p className="text-xs text-amber-800/90">Manual broker interventions were recorded without corresponding rated customer charges.</p>
          <div className="divide-y divide-amber-200 text-xs font-mono text-amber-900">
            {leakageAlerts.slice(0, 5).map((l) => (
              <div key={l.eventId} className="py-2 flex items-center justify-between"><span>[{l.eventCode}] {l.reason} (Shipment: {l.shipmentId ?? "N/A"})</span><span className="text-[10px] text-amber-700">{new Date(l.occurredAt).toLocaleDateString()}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]"><tr><th className="px-5 py-3">Exception Type</th><th className="px-5 py-3">Severity</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Shipment / Client</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Logged Date</th></tr></thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs">
              {exceptions.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-muted text-sm font-sans">No billing exceptions are currently recorded for this account.</td></tr>
              ) : exceptions.map((ex) => (
                <tr key={ex.id} className="hover:bg-[#F9F9FB] transition-colors">
                  <td className="px-5 py-4 font-bold text-ink font-mono">{ex.type}</td>
                  <td className="px-5 py-4 font-sans"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ex.severity === "HIGH" || ex.severity === "CRITICAL" ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{ex.severity}</span></td>
                  <td className="px-5 py-4 text-ink max-w-xs truncate">{ex.description}</td>
                  <td className="px-5 py-4 text-ink-muted">{ex.shipment?.shipmentNumber ?? ex.client?.name ?? "Workspace"}</td>
                  <td className="px-5 py-4 font-sans"><span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">{ex.status}</span></td>
                  <td className="px-5 py-4 font-mono text-ink-muted">{new Date(ex.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
