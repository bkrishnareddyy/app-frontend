import React from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";

export const revalidate = 0;

export default async function UsageLedgerPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  const canViewCost = await hasPermission("billing.cost.view");

  const events = await db.usageEvent.findMany({
    where: { accountId: ctx.accountId },
    take: 100,
    orderBy: { occurredAt: "desc" },
    include: {
      client: { select: { name: true } },
      shipment: { select: { shipmentNumber: true } },
      eventDefinition: { select: { name: true, category: true } },
      charges: { select: { id: true, netAmount: true, status: true } },
      ...(canViewCost ? { costs: { select: { id: true, amount: true, costType: true } } } : {}),
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Usage Event Ledger</h2>
        <p className="text-sm text-ink-muted">Immutable telemetry of economically meaningful operational work for this brokerage account.</p>
      </div>

      <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Event Code & Definition</th>
                <th className="px-5 py-3">Shipment / Client</th>
                <th className="px-5 py-3">Qty / Unit</th>
                <th className="px-5 py-3">Source Function</th>
                <th className="px-5 py-3">Rated Charge</th>
                {canViewCost && <th className="px-5 py-3">Internal Cost</th>}
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] font-mono text-xs">
              {events.length === 0 ? (
                <tr><td colSpan={canViewCost ? 8 : 7} className="px-5 py-8 text-center text-ink-muted text-sm font-sans">No usage events recorded yet. Operational activities will automatically emit telemetry.</td></tr>
              ) : events.map((event) => {
                const charge = event.charges[0];
                const costs = "costs" in event && Array.isArray(event.costs) ? event.costs : [];
                const costSum = costs.reduce((acc, c) => acc + Number(c.amount), 0);
                return (
                  <tr key={event.id} className="hover:bg-[#F9F9FB] transition-colors">
                    <td className="px-5 py-4 text-ink-muted">{new Date(event.occurredAt).toLocaleString()}</td>
                    <td className="px-5 py-4"><div className="font-bold text-ink font-sans">{event.eventDefinition?.name ?? event.eventCode}</div><div className="text-[10px] text-ink-muted">{event.eventCode}</div></td>
                    <td className="px-5 py-4 text-ink font-sans"><div>{event.shipment?.shipmentNumber ?? "N/A"}</div><div className="text-xs text-ink-muted">{event.client?.name ?? "Brokerage"}</div></td>
                    <td className="px-5 py-4 text-ink">{Number(event.quantity)} {event.unit}</td>
                    <td className="px-5 py-4 text-ink-muted">{event.sourceFunction}</td>
                    <td className="px-5 py-4 text-emerald-600 font-semibold">{charge ? `$${Number(charge.netAmount).toFixed(2)}` : "Unrated"}</td>
                    {canViewCost && <td className="px-5 py-4 text-ink-muted">${costSum.toFixed(2)}</td>}
                    <td className="px-5 py-4 font-sans"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${event.success ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>{event.success ? "SUCCESS" : "FAILED"}</span></td>
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
