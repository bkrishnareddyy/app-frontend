import React from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { getShipmentFinancialSummary } from "@/lib/billing/ledger";

export const revalidate = 0;

export default async function ShipmentEconomicsPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  const [canViewCost, canViewMargin] = await Promise.all([
    hasPermission("billing.cost.view"),
    hasPermission("billing.margin.view"),
  ]);

  const shipments = await db.shipment.findMany({
    where: { accountId: ctx.accountId, deletedAt: null },
    take: 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shipmentNumber: true,
      importerName: true,
      status: true,
      createdAt: true,
      client: { select: { name: true } },
    },
  });

  const summaries = await Promise.all(
    shipments.map(async (shipment) => ({
      shipment,
      summary: await getShipmentFinancialSummary(shipment.id),
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Shipment Economics & Unit Margins</h2>
        <p className="text-sm text-ink-muted">Shipment-level revenue and AR state, with internal cost and margin shown only to authorized billing users.</p>
      </div>

      <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr>
                <th className="px-5 py-3">Shipment #</th><th className="px-5 py-3">Client / Importer</th><th className="px-5 py-3">Customer Revenue</th>
                {canViewCost && <th className="px-5 py-3">Internal Cost</th>}
                {canViewMargin && <><th className="px-5 py-3">Gross Profit</th><th className="px-5 py-3">Gross Margin %</th></>}
                <th className="px-5 py-3">AR Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] font-mono text-xs">
              {summaries.length === 0 ? (
                <tr><td colSpan={4 + (canViewCost ? 1 : 0) + (canViewMargin ? 2 : 0)} className="px-5 py-8 text-center text-ink-muted text-sm font-sans">No shipments found with financial ledgers.</td></tr>
              ) : summaries.map(({ shipment, summary }) => {
                if (!summary) return null;
                const isNegativeMargin = summary.grossProfit < 0;
                return (
                  <tr key={shipment.id} className="hover:bg-[#F9F9FB] transition-colors">
                    <td className="px-5 py-4 font-bold text-ink font-sans">{shipment.shipmentNumber}</td>
                    <td className="px-5 py-4 font-sans text-ink"><div>{shipment.client?.name ?? shipment.importerName}</div></td>
                    <td className="px-5 py-4 text-emerald-600 font-semibold">${summary.netRevenue.toFixed(2)}</td>
                    {canViewCost && <td className="px-5 py-4 text-ink-muted">${summary.totalCost.toFixed(2)}</td>}
                    {canViewMargin && <><td className={`px-5 py-4 font-semibold ${isNegativeMargin ? "text-rose-600" : "text-purple-700"}`}>${summary.grossProfit.toFixed(2)}</td><td className="px-5 py-4 font-sans"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${isNegativeMargin ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>{summary.grossMarginPct.toFixed(1)}%</span></td></>}
                    <td className="px-5 py-4 font-sans text-xs"><span className="text-ink-muted">Unbilled: ${summary.arStatus.unbilled.toFixed(2)} | Invoiced: ${summary.arStatus.invoiced.toFixed(2)} | Outstanding: ${summary.arStatus.outstanding.toFixed(2)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
