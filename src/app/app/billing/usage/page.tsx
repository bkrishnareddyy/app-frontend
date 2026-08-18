import React from "react";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function UsageLedgerPage() {
  const events = await db.usageEvent.findMany({
    take: 100,
    orderBy: { occurredAt: "desc" },
    include: {
      client: { select: { name: true } },
      shipment: { select: { shipmentNumber: true } },
      eventDefinition: { select: { name: true, category: true } },
      charges: { select: { id: true, netAmount: true, status: true } },
      costs: { select: { id: true, amount: true, costType: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Usage Event Ledger</h2>
        <p className="text-sm text-slate-400">
          Immutable telemetry of all operational work events emitted across Qubere services.
        </p>
      </div>

      <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Event Code & Definition</th>
                <th className="px-5 py-3">Shipment / Client</th>
                <th className="px-5 py-3">Qty / Unit</th>
                <th className="px-5 py-3">Source Function</th>
                <th className="px-5 py-3">Rated Charge</th>
                <th className="px-5 py-3">Internal Cost</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500 text-sm font-sans">
                    No usage events recorded yet. Operational activities will automatically emit telemetry.
                  </td>
                </tr>
              ) : (
                events.map((event) => {
                  const charge = event.charges[0];
                  const costSum = event.costs.reduce((acc, c) => acc + Number(c.amount), 0);
                  return (
                    <tr key={event.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-4 text-slate-400">
                        {new Date(event.occurredAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-semibold text-white font-sans">
                          {event.eventDefinition?.name ?? event.eventCode}
                        </div>
                        <div className="text-[10px] text-slate-500">{event.eventCode}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-300 font-sans">
                        <div>{event.shipment?.shipmentNumber ?? "N/A"}</div>
                        <div className="text-xs text-slate-500">{event.client?.name ?? "Brokerage"}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        {Number(event.quantity)} {event.unit}
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        {event.sourceFunction}
                      </td>
                      <td className="px-5 py-4 text-emerald-400 font-semibold">
                        {charge ? `$${Number(charge.netAmount).toFixed(2)}` : "Unrated"}
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        ${costSum.toFixed(2)}
                      </td>
                      <td className="px-5 py-4 font-sans">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            event.success
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {event.success ? "SUCCESS" : "FAILED"}
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
