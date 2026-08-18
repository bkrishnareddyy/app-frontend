import React from "react";
import { db } from "@/lib/db";
import { detectRevenueLeakage } from "@/lib/billing/ledger";

export const revalidate = 0;

export default async function BillingExceptionsPage() {
  const exceptions = await db.billingException.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      shipment: { select: { shipmentNumber: true } },
    },
  });

  // Also query active account ID (fallback to first account)
  const account = await db.account.findFirst();
  const leakageAlerts = account ? await detectRevenueLeakage(account.id) : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Exceptions & Revenue Leakage Center</h2>
        <p className="text-sm text-slate-400">
          Automated audit detection of missing rates, unbilled manual broker labor, zero-rated events, and negative margin entries.
        </p>
      </div>

      {/* Revenue Leakage Alert Summary Box */}
      {leakageAlerts.length > 0 && (
        <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
          <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Revenue Leakage Alert: {leakageAlerts.length} Unbilled Manual Work Events Detected
          </h3>
          <p className="text-xs text-amber-200/80">
            The system identified manual broker review or exception handling interventions performed without a corresponding billable charge created.
          </p>
          <div className="divide-y divide-amber-500/20 text-xs font-mono text-amber-200">
            {leakageAlerts.slice(0, 5).map((l) => (
              <div key={l.eventId} className="py-2 flex items-center justify-between">
                <span>
                  [{l.eventCode}] {l.reason} (Shipment: {l.shipmentId ?? "N/A"})
                </span>
                <span className="text-[10px] text-amber-400">{new Date(l.occurredAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exceptions Table */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Exception Type</th>
                <th className="px-5 py-3">Severity</th>
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3">Shipment / Client</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Logged Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {exceptions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500 text-sm font-sans">
                    No open billing exceptions. All operational events have been properly rated and billed!
                  </td>
                </tr>
              ) : (
                exceptions.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4 font-semibold text-white font-mono">
                      {ex.type}
                    </td>
                    <td className="px-5 py-4 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          ex.severity === "HIGH" || ex.severity === "CRITICAL"
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {ex.severity}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-300 max-w-xs truncate">
                      {ex.description}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {ex.shipment?.shipmentNumber ?? ex.client?.name ?? "Global Workspace"}
                    </td>
                    <td className="px-5 py-4 font-sans">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                        {ex.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-slate-400">
                      {new Date(ex.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
