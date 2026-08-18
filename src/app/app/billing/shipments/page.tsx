import React from "react";
import { db } from "@/lib/db";
import { getShipmentFinancialSummary } from "@/lib/billing/ledger";

export const revalidate = 0;

export default async function ShipmentEconomicsPage() {
  const shipments = await db.shipment.findMany({
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
    shipments.map(async (s) => {
      const summary = await getShipmentFinancialSummary(s.id);
      return { shipment: s, summary };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Shipment Economics & Unit Margins</h2>
        <p className="text-sm text-slate-400">
          Individual financial ledgers showing Customer Revenue, Internal Cost, Gross Margin %, and AR Status.
        </p>
      </div>

      <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Shipment #</th>
                <th className="px-5 py-3">Client / Importer</th>
                <th className="px-5 py-3">Customer Revenue</th>
                <th className="px-5 py-3">Internal Cost</th>
                <th className="px-5 py-3">Gross Profit</th>
                <th className="px-5 py-3">Gross Margin %</th>
                <th className="px-5 py-3">AR Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {summaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500 text-sm font-sans">
                    No shipments found with financial ledgers.
                  </td>
                </tr>
              ) : (
                summaries.map(({ shipment, summary }) => {
                  if (!summary) return null;
                  const isNegativeMargin = summary.grossProfit < 0;
                  return (
                    <tr key={shipment.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-4 font-semibold text-white font-sans">
                        {shipment.shipmentNumber}
                      </td>
                      <td className="px-5 py-4 font-sans text-slate-300">
                        <div>{shipment.client?.name ?? shipment.importerName}</div>
                      </td>
                      <td className="px-5 py-4 text-emerald-400 font-semibold">
                        ${summary.netRevenue.toFixed(2)}
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        ${summary.totalCost.toFixed(2)}
                      </td>
                      <td
                        className={`px-5 py-4 font-semibold ${
                          isNegativeMargin ? "text-rose-400" : "text-purple-300"
                        }`}
                      >
                        ${summary.grossProfit.toFixed(2)}
                      </td>
                      <td className="px-5 py-4 font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isNegativeMargin
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          }`}
                        >
                          {summary.grossMarginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-4 font-sans text-xs">
                        <span className="text-slate-400">
                          Unbilled: ${summary.arStatus.unbilled.toFixed(2)} | Invoiced: ${summary.arStatus.invoiced.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
