import React from "react";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function BillingReportsPage() {
  const clients = await db.client.findMany({
    take: 20,
    select: {
      id: true,
      name: true,
      shipments: {
        select: {
          id: true,
          shipmentCharges: { select: { netAmount: true } },
          shipmentCosts: { select: { amount: true } },
        },
      },
    },
  });

  const clientEconomics = clients.map((client) => {
    let rev = 0;
    let cost = 0;
    for (const s of client.shipments) {
      for (const c of s.shipmentCharges) rev += Number(c.netAmount);
      for (const cs of s.shipmentCosts) cost += Number(cs.amount);
    }
    const profit = rev - cost;
    const margin = rev > 0 ? (profit / rev) * 100 : 0;
    return { client, rev, cost, profit, margin, shipmentCount: client.shipments.length };
  });

  // AI Agent ROI Mock Telemetry Summary
  const agentMetrics = [
    { agent: "Document Intelligence Agent", executions: 1420, cost: 28.40, revenue: 3550.00, escalationRate: "1.8%" },
    { agent: "HTS Classification Agent", executions: 3820, cost: 114.60, revenue: 15280.00, escalationRate: "4.2%" },
    { agent: "PGA Validation Agent", executions: 640, cost: 19.20, revenue: 22400.00, escalationRate: "2.1%" },
    { agent: "Filing Readiness Agent", executions: 980, cost: 24.50, revenue: 9800.00, escalationRate: "0.5%" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white">Profitability & Unit Economics Analytics</h2>
        <p className="text-sm text-slate-400">
          Client-level margins, AI Agent ROI, and broker productivity economics.
        </p>
      </div>

      {/* AI Agent ROI Breakdown */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-white">AI Agent ROI & Economic Performance</h3>
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">AI Agent Capability</th>
                <th className="px-5 py-3">Executions</th>
                <th className="px-5 py-3">Internal Tech Cost</th>
                <th className="px-5 py-3">Customer Revenue</th>
                <th className="px-5 py-3">Human Escalation Rate</th>
                <th className="px-5 py-3">ROI Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
              {agentMetrics.map((ag) => {
                const roi = (ag.revenue / ag.cost).toFixed(1);
                return (
                  <tr key={ag.agent} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4 font-semibold text-white font-sans">{ag.agent}</td>
                    <td className="px-5 py-4">{ag.executions.toLocaleString()}</td>
                    <td className="px-5 py-4 text-slate-400">${ag.cost.toFixed(2)}</td>
                    <td className="px-5 py-4 text-emerald-400 font-semibold">${ag.revenue.toFixed(2)}</td>
                    <td className="px-5 py-4 font-sans text-slate-300">{ag.escalationRate}</td>
                    <td className="px-5 py-4 text-purple-300 font-bold">{roi}x</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Client Profitability Breakdown */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-white">Client Profitability Matrix</h3>
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Client Name</th>
                <th className="px-5 py-3">Total Entries</th>
                <th className="px-5 py-3">Revenue</th>
                <th className="px-5 py-3">Internal Cost</th>
                <th className="px-5 py-3">Gross Profit</th>
                <th className="px-5 py-3">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
              {clientEconomics.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500 font-sans">
                    No client profitability data available yet.
                  </td>
                </tr>
              ) : (
                clientEconomics.map(({ client, rev, cost, profit, margin, shipmentCount }) => (
                  <tr key={client.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4 font-semibold text-white font-sans">{client.name}</td>
                    <td className="px-5 py-4">{shipmentCount}</td>
                    <td className="px-5 py-4 text-emerald-400 font-semibold">${rev.toFixed(2)}</td>
                    <td className="px-5 py-4 text-slate-400">${cost.toFixed(2)}</td>
                    <td className="px-5 py-4 text-purple-300 font-semibold">${profit.toFixed(2)}</td>
                    <td className="px-5 py-4 font-sans">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {margin.toFixed(1)}%
                      </span>
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
