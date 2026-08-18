import React from "react";
import Link from "next/link";
import { db } from "@/lib/db";

export const revalidate = 0;

export default async function RateCardsPage() {
  const rateCards = await db.rateCard.findMany({
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
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Rate Cards</h2>
          <p className="text-sm text-slate-400">
            Define pricing rules, capability mappings, volume tiers, and rate card versions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/app/billing/rate-cards/import"
            className="px-3.5 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
          >
            Import Rate Card (XLSX/CSV)
          </Link>
          <Link
            href="/app/billing/rate-cards/new"
            className="px-3.5 py-2 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors border border-slate-700"
          >
            + Create Rate Card
          </Link>
        </div>
      </div>

      {/* Rate Cards Table */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
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
            <tbody className="divide-y divide-slate-800/60">
              {rateCards.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500 text-sm">
                    No rate cards found. Create or upload a rate card to get started.
                  </td>
                </tr>
              ) : (
                rateCards.map((rc) => {
                  const latestVersion = rc.versions[0];
                  return (
                    <tr key={rc.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-4 font-semibold text-white">
                        {rc.name}
                        {rc.isDefault && (
                          <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            Default
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400">
                        {rc.client?.name ?? rc.importer?.name ?? "Brokerage Default"}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-slate-300">
                        v{rc.currentVersion}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-300">
                        {latestVersion?._count.rules ?? 0} line items
                      </td>
                      <td className="px-5 py-4 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            rc.status === "ACTIVE"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : rc.status === "DRAFT"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {rc.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400">{rc.currency}</td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/app/billing/rate-cards/${rc.id}`}
                          className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          Edit & Map →
                        </Link>
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
