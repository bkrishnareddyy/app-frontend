import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";

export const revalidate = 0;

export default async function RateCardsPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/sign-in");
  if (!(await hasPermission("billing.ratecard.manage"))) redirect("/app/billing");

  const rateCards = await db.rateCard.findMany({
    where: { accountId: ctx.accountId },
    include: {
      client: { select: { name: true } },
      importer: { select: { name: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { _count: { select: { rules: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ink">Rate Cards</h2>
          <p className="text-sm text-ink-muted">Define pricing rules, capability mappings, volume tiers, and rate-card versions.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/app/billing/rate-cards/import" className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm">
            Import Rate Card
          </Link>
          <Link href="/app/billing/rate-cards/new" className="px-4 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 text-ink transition-colors border border-[#E5E5EA] shadow-sm">
            + Create Rate Card
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-xs tracking-wider border-b border-[#E5E5EA]">
              <tr>
                <th className="px-5 py-3">Rate Card Name</th>
                <th className="px-5 py-3">Target / Scope</th>
                <th className="px-5 py-3">Version</th>
                <th className="px-5 py-3">Rules Count</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Currency</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {rateCards.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-ink-muted text-sm">No rate cards found. Create or upload a rate card to get started.</td></tr>
              ) : rateCards.map((rc) => {
                const latestVersion = rc.versions[0];
                return (
                  <tr key={rc.id} className="hover:bg-[#F9F9FB] transition-colors">
                    <td className="px-5 py-4 font-bold text-ink">
                      {rc.name}
                      {rc.isDefault && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-brand border border-blue-100">Default</span>}
                    </td>
                    <td className="px-5 py-4 text-xs text-ink-muted">{rc.client?.name ?? rc.importer?.name ?? "Brokerage Default"}</td>
                    <td className="px-5 py-4 text-xs font-mono text-ink">v{rc.currentVersion}</td>
                    <td className="px-5 py-4 text-xs text-ink-muted">{latestVersion?._count.rules ?? 0} line items</td>
                    <td className="px-5 py-4 text-xs">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${rc.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : rc.status === "DRAFT" ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-slate-100 text-slate-500"}`}>{rc.status}</span>
                    </td>
                    <td className="px-5 py-4 text-xs text-ink-muted">{rc.currency}</td>
                    <td className="px-5 py-4 text-right"><Link href={`/app/billing/rate-cards/${rc.id}`} className="text-xs font-semibold text-brand hover:underline">Edit & Map →</Link></td>
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
