import React from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";

export const revalidate = 0;

export default async function BrokerWorkloadPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.reports.view"))) redirect("/app/billing");
  const canViewCost = await hasPermission("billing.cost.view");

  // Manual usage events grouped by userId
  const manualEvents = await db.usageEvent.findMany({
    where: { accountId: ctx.accountId, automated: false, userId: { not: null } },
    select: {
      userId: true,
      shipmentId: true,
      success: true,
      processingDuration: true,
    },
  });

  // Labor costs per userId (from ShipmentCost where costType = LABOR and userId is set)
  const laborCosts = await db.shipmentCost.findMany({
    where: { accountId: ctx.accountId, costType: "LABOR" },
    select: { userId: true, amount: true, durationSec: true },
  });

  // Resolve user display names from UserProfile or User table
  const userIds = [...new Set([
    ...manualEvents.map((e) => e.userId).filter(Boolean),
    ...laborCosts.map((c) => c.userId).filter(Boolean),
  ])] as string[];

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, { ...u, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email }]));

  // Aggregate per user
  const brokerMap = new Map<string, {
    userId: string;
    name: string;
    email: string;
    shipmentIds: Set<string>;
    interventions: number;
    failures: number;
    totalDurationMs: number;
    durationSec: number;
    laborCost: number;
  }>();

  for (const ev of manualEvents) {
    if (!ev.userId) continue;
    const existing = brokerMap.get(ev.userId) ?? {
      userId: ev.userId,
      name: userMap.get(ev.userId)?.name ?? "Unknown",
      email: userMap.get(ev.userId)?.email ?? ev.userId,
      shipmentIds: new Set(),
      interventions: 0,
      failures: 0,
      totalDurationMs: 0,
      durationSec: 0,
      laborCost: 0,
    };
    existing.interventions += 1;
    if (!ev.success) existing.failures += 1;
    if (ev.shipmentId) existing.shipmentIds.add(ev.shipmentId);
    if (ev.processingDuration) existing.totalDurationMs += ev.processingDuration;
    brokerMap.set(ev.userId, existing);
  }

  for (const cost of laborCosts) {
    if (!cost.userId) continue;
    const existing = brokerMap.get(cost.userId);
    if (!existing) continue;
    existing.laborCost += Number(cost.amount);
    existing.durationSec += cost.durationSec ?? 0;
  }

  const brokers = Array.from(brokerMap.values())
    .map((b) => ({
      ...b,
      shipmentCount: b.shipmentIds.size,
      avgDurationMs: b.interventions > 0 ? b.totalDurationMs / b.interventions : 0,
      successRate: b.interventions > 0 ? ((b.interventions - b.failures) / b.interventions) * 100 : 100,
      hoursFromCost: b.durationSec / 3600,
    }))
    .sort((a, b) => b.interventions - a.interventions);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Operational Workload & Automation Opportunity</h2>
        <p className="text-sm text-ink-muted">
          Manual-review activity by staff member — derived from billing telemetry, not productivity tracking.
          Use this to identify where automation can reduce manual burden, not to evaluate individual performance.
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr>
                <th className="px-5 py-3">Staff Member</th>
                <th className="px-5 py-3">Shipments Touched</th>
                <th className="px-5 py-3">Manual Reviews</th>
                <th className="px-5 py-3">Success Rate</th>
                {canViewCost && (
                  <>
                    <th className="px-5 py-3">Tracked Hours</th>
                    <th className="px-5 py-3">Labor Cost</th>
                    <th className="px-5 py-3">Avg Review Time</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs font-mono">
              {brokers.length === 0 ? (
                <tr>
                  <td colSpan={canViewCost ? 7 : 4} className="px-5 py-8 text-center text-ink-muted font-sans">
                    No manual review activity recorded yet. Billing telemetry will appear here once brokers take actions on shipments.
                  </td>
                </tr>
              ) : brokers.map((b) => (
                <tr key={b.userId} className="hover:bg-[#F9F9FB] transition-colors">
                  <td className="px-5 py-4 font-sans">
                    <div className="font-semibold text-ink">{b.name}</div>
                    <div className="text-ink-muted text-[10px]">{b.email}</div>
                  </td>
                  <td className="px-5 py-4">{b.shipmentCount}</td>
                  <td className="px-5 py-4">{b.interventions}</td>
                  <td className="px-5 py-4 font-sans">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      b.successRate >= 95 ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : b.successRate >= 80 ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-rose-50 text-rose-700 border border-rose-200"
                    }`}>
                      {b.successRate.toFixed(1)}%
                    </span>
                  </td>
                  {canViewCost && (
                    <>
                      <td className="px-5 py-4 text-ink-muted">{b.hoursFromCost > 0 ? `${b.hoursFromCost.toFixed(1)}h` : "—"}</td>
                      <td className="px-5 py-4 text-ink-muted">{b.laborCost > 0 ? `$${b.laborCost.toFixed(2)}` : "—"}</td>
                      <td className="px-5 py-4 text-ink-muted">
                        {b.avgDurationMs > 0 ? `${Math.round(b.avgDurationMs / 1000)}s` : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-ink-muted">
        Hours are sourced from tracked labor cost records, not time estimates. Review time is sourced from
        billing telemetry duration fields and is only recorded when a timer is active on the client.
      </p>
    </div>
  );
}
