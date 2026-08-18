import React from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";

export const revalidate = 0;

export default async function BillingReportsPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.reports.view"))) redirect("/app/billing");
  const canViewCost = await hasPermission("billing.cost.view");

  const clients = await db.client.findMany({
    where: { accountId: ctx.accountId },
    take: 20,
    select: {
      id: true,
      name: true,
      shipments: {
        where: { accountId: ctx.accountId },
        select: {
          id: true,
          shipmentCharges: { where: { accountId: ctx.accountId }, select: { netAmount: true } },
          ...(canViewCost ? { shipmentCosts: { where: { accountId: ctx.accountId }, select: { amount: true } } } : {}),
        },
      },
    },
  });

  const clientEconomics = clients.map((client) => {
    let rev = 0;
    let cost = 0;
    for (const shipment of client.shipments) {
      for (const charge of shipment.shipmentCharges) rev += Number(charge.netAmount);
      const costs = "shipmentCosts" in shipment && Array.isArray(shipment.shipmentCosts) ? shipment.shipmentCosts : [];
      for (const shipmentCost of costs) cost += Number(shipmentCost.amount);
    }
    const profit = rev - cost;
    const margin = rev > 0 ? (profit / rev) * 100 : 0;
    return { client, rev, cost, profit, margin, shipmentCount: client.shipments.length };
  });

  const agentUsageEvents = await db.usageEvent.findMany({
    where: { accountId: ctx.accountId, automated: true, sourceAgent: { not: null } },
    include: {
      charges: { where: { accountId: ctx.accountId }, select: { netAmount: true } },
      ...(canViewCost ? { costs: { where: { accountId: ctx.accountId }, select: { amount: true } } } : {}),
    },
  });

  const agentGroups = new Map<string, { agent: string; executions: number; cost: number; revenue: number; failed: number }>();
  for (const ev of agentUsageEvents) {
    const agentName = ev.sourceAgent ?? "AI Agent";
    const current = agentGroups.get(agentName) ?? { agent: agentName, executions: 0, cost: 0, revenue: 0, failed: 0 };
    current.executions += 1;
    if (!ev.success) current.failed += 1;
    for (const charge of ev.charges) current.revenue += Number(charge.netAmount);
    const costs = "costs" in ev && Array.isArray(ev.costs) ? ev.costs : [];
    for (const cost of costs) current.cost += Number(cost.amount);
    agentGroups.set(agentName, current);
  }

  const agentMetrics = Array.from(agentGroups.values());

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-ink">Profitability & Unit Economics Analytics</h2>
        <p className="text-sm text-ink-muted">Client-level and AI-agent economics derived only from this brokerage account's operational telemetry.</p>
      </div>

      <div className="space-y-4">
        <h3 className="text-base font-bold text-ink">AI Agent ROI & Economic Performance</h3>
        <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]"><tr><th className="px-5 py-3">AI Agent Capability</th><th className="px-5 py-3">Executions</th>{canViewCost && <th className="px-5 py-3">Internal Tech Cost</th>}<th className="px-5 py-3">Customer Revenue</th><th className="px-5 py-3">Failure Rate</th>{canViewCost && <th className="px-5 py-3">ROI Ratio</th>}</tr></thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs font-mono">
              {agentMetrics.length === 0 ? (
                <tr><td colSpan={canViewCost ? 6 : 4} className="px-5 py-8 text-center text-ink-muted font-sans">No automated AI-agent executions recorded yet.</td></tr>
              ) : agentMetrics.map((ag) => {
                const roi = ag.cost > 0 ? (ag.revenue / ag.cost).toFixed(1) : "N/A";
                const failRate = ag.executions > 0 ? ((ag.failed / ag.executions) * 100).toFixed(1) : "0.0";
                return (
                  <tr key={ag.agent} className="hover:bg-[#F9F9FB] transition-colors">
                    <td className="px-5 py-4 font-bold text-ink font-sans">{ag.agent}</td><td className="px-5 py-4">{ag.executions.toLocaleString()}</td>
                    {canViewCost && <td className="px-5 py-4 text-ink-muted">${ag.cost.toFixed(2)}</td>}
                    <td className="px-5 py-4 text-emerald-600 font-semibold">${ag.revenue.toFixed(2)}</td><td className="px-5 py-4 font-sans text-ink">{failRate}%</td>
                    {canViewCost && <td className="px-5 py-4 text-purple-700 font-bold">{roi === "N/A" ? "N/A" : `${roi}x`}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-base font-bold text-ink">Client Profitability Matrix</h3>
        <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]"><tr><th className="px-5 py-3">Client Name</th><th className="px-5 py-3">Total Entries</th><th className="px-5 py-3">Revenue</th>{canViewCost && <><th className="px-5 py-3">Internal Cost</th><th className="px-5 py-3">Gross Profit</th><th className="px-5 py-3">Margin %</th></>}</tr></thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs font-mono">
              {clientEconomics.length === 0 ? (
                <tr><td colSpan={canViewCost ? 6 : 3} className="px-5 py-8 text-center text-ink-muted font-sans">No client profitability data available yet.</td></tr>
              ) : clientEconomics.map(({ client, rev, cost, profit, margin, shipmentCount }) => (
                <tr key={client.id} className="hover:bg-[#F9F9FB] transition-colors">
                  <td className="px-5 py-4 font-bold text-ink font-sans">{client.name}</td><td className="px-5 py-4">{shipmentCount}</td><td className="px-5 py-4 text-emerald-600 font-semibold">${rev.toFixed(2)}</td>
                  {canViewCost && <><td className="px-5 py-4 text-ink-muted">${cost.toFixed(2)}</td><td className="px-5 py-4 text-purple-700 font-semibold">${profit.toFixed(2)}</td><td className="px-5 py-4 font-sans"><span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">{margin.toFixed(1)}%</span></td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
