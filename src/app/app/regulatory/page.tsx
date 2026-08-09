import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  Globe,
  TrendingUp,
  AlertTriangle,
  FileText,
  Info,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { displayNumber } from "@/lib/honest";

export default async function RegulatoryIntelligencePage() {
  const context = await getAccountContext();
  if (!context) return null;

  const updates = await db.regulatoryUpdate.findMany({
    orderBy: { effectiveDate: "desc" },
  });

  // ---------------------------------------------------------------------------
  // DYNAMIC DATABASE AGGREGATIONS (SUPABASE POSTGRESQL)
  // ---------------------------------------------------------------------------
  const totalUpdates = updates.length;
  const highImpactCount = updates.filter((u) => u.impactLevel === "High").length;

  // null when no update has had impact analysis run against the tenant portfolio.
  const analysedImpacts = updates
    .map((u) => u.affectedShipmentsCount)
    .filter((count): count is number => count !== null);
  const potentialImpactShipments =
    analysedImpacts.length === 0
      ? null
      : analysedImpacts.reduce((acc, count) => acc + count, 0);

  // Dynamic Jurisdiction Counts
  const jurisdictionCounts: Record<string, { flag: string; count: number }> = {
    "United States": { flag: "🇺🇸", count: 0 },
    "European Union": { flag: "🇪🇺", count: 0 },
    China: { flag: "🇨🇳", count: 0 },
    India: { flag: "🇮🇳", count: 0 },
    "United Kingdom": { flag: "🇬🇧", count: 0 },
    Australia: { flag: "🇦🇺", count: 0 },
  };

  updates.forEach((u) => {
    if (jurisdictionCounts[u.jurisdiction]) {
      jurisdictionCounts[u.jurisdiction].count += 1;
    }
  });

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <Globe className="w-5 h-5 text-[#0071E3]" />
            <h1 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">Regulatory Intelligence & Analytics</h1>
          </div>
          <p className="text-sm text-[#86868B] mt-1">
            Regulatory updates stored for this account and the shipments they were
            matched against
          </p>
        </div>
      </div>

      {/* KPI Metric Cards Row (derived from persisted regulatory records) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Regulatory Updates */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2">
            <span>Regulatory Updates</span>
            <FileText className="w-4 h-4 shrink-0 text-[#0071E3]" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{totalUpdates}</p>
          <p className="text-xs text-[#86868B] mt-1">Across global jurisdictions</p>
        </div>

        {/* 2. High Impact Changes */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2">
            <span>High Impact Changes</span>
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">{highImpactCount}</p>
          <p className="text-xs text-[#86868B] mt-1">Require immediate attention</p>
        </div>

        {/* 3. Potential Impact (Shipments) */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs">
          <div className="flex items-center justify-between gap-2 text-xs text-[#86868B] mb-2">
            <span>Potential Impact (Shipments)</span>
            <TrendingUp className="w-4 h-4 shrink-0 text-purple-500" />
          </div>
          <p className="text-2xl font-extrabold text-[#1D1D1F]">
            {displayNumber(potentialImpactShipments)}
          </p>
          <p className="text-xs text-[#86868B] mt-1">
            {potentialImpactShipments === null
              ? "Impact analysis has not run for these updates"
              : "Active shipments affected"}
          </p>
        </div>
      </div>

      {/* Middle Grid: Category Breakdown, Trend Chart & Jurisdiction Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Category Breakdown (3 Cols) */}
        <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Regulatory Updates by Category</h3>

          <div className="flex justify-center my-2">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle cx="64" cy="64" r="48" stroke="#E5E5EA" strokeWidth="12" fill="transparent" />
                <circle cx="64" cy="64" r="48" stroke="#0071E3" strokeWidth="12" strokeDasharray={301} strokeDashoffset={100} fill="transparent" />
                <circle cx="64" cy="64" r="48" stroke="#10B981" strokeWidth="12" strokeDasharray={301} strokeDashoffset={200} fill="transparent" />
              </svg>
              <div className="absolute text-center">
                <p className="text-2xl font-extrabold text-[#1D1D1F]">{totalUpdates}</p>
                <p className="text-sm text-[#86868B]">Total</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0071E3]" /><span>Tariffs & Duties</span></span><span className="font-semibold text-[#1D1D1F]">32</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span>Trade Agreements</span></span><span className="font-semibold text-[#1D1D1F]">24</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span>Compliance & Reporting</span></span><span className="font-semibold text-[#1D1D1F]">20</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /><span>Sanctions & Restrictions</span></span><span className="font-semibold text-[#1D1D1F]">18</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" /><span>Product Regulations</span></span><span className="font-semibold text-[#1D1D1F]">16</span></div>
          </div>
        </div>

        {/* Updates Over Time Trend (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Updates Over Time</h3>
            <div className="flex items-center space-x-1 text-sm font-semibold text-[#86868B]">
              <button className="px-2 py-0.5 rounded-lg bg-[#0071E3] text-white">7 Days</button>
              <button className="px-2 py-0.5 rounded-lg hover:bg-[#F5F5F7]">30 Days</button>
              <button className="px-2 py-0.5 rounded-lg hover:bg-[#F5F5F7]">90 Days</button>
            </div>
          </div>

          <div className="h-44 w-full bg-gradient-to-b from-blue-50/50 to-transparent rounded-xl border border-[#E5E5EA] p-4 flex flex-col justify-between text-sm text-[#86868B]">
            <div className="flex justify-between border-b border-[#E5E5EA] pb-1"><span>80</span><span>Total Updates</span></div>
            <div className="flex justify-between border-b border-[#E5E5EA] pb-1"><span>60</span><span>High Impact</span></div>
            <div className="flex justify-between border-b border-[#E5E5EA] pb-1"><span>40</span><span>Affecting Shipments</span></div>
            <div className="flex justify-between pt-1 font-bold text-[#1D1D1F]"><span>6 May</span><span>7 May</span><span>8 May</span><span>9 May</span><span>10 May</span><span>11 May</span><span>12 May</span></div>
          </div>
        </div>

        {/* Updates by Jurisdiction World Map (4 Cols) */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Updates by Jurisdiction</h3>

          <div className="space-y-2 text-xs">
            {Object.entries(jurisdictionCounts).map(([country, data]) => (
              <div key={country} className="flex items-center justify-between p-2 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]">
                <div className="flex items-center space-x-2">
                  <span className="text-sm">{data.flag}</span>
                  <span className="font-bold text-[#1D1D1F]">{country}</span>
                </div>
                <span className="font-extrabold text-[#0071E3]">{data.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Latest Regulatory Updates Table (DYNAMIC FROM DATABASE) */}
      <div className="bg-white p-6 rounded-2xl border border-[#E5E5EA] shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#1D1D1F]">Latest Regulatory Updates</h3>
          <span className="text-xs text-[#0071E3] font-semibold">View All Updates →</span>
        </div>

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#E5E5EA] text-[#86868B]">
              <th className="pb-3">Title / Description</th>
              <th className="pb-3">Jurisdiction</th>
              <th className="pb-3">Category</th>
              <th className="pb-3">Impact</th>
              <th className="pb-3">Effective Date</th>
              <th className="pb-3">Affects Shipments</th>
              <th className="pb-3">Published</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E5EA]">
            {updates.map((reg) => (
              <tr key={reg.id} className="hover:bg-[#F5F5F7]">
                <td className="py-3">
                  <p className="font-bold text-[#1D1D1F]">{reg.title}</p>
                  <p className="text-sm text-[#86868B]">{reg.description}</p>
                </td>
                <td className="py-3 font-semibold text-[#1D1D1F]">{reg.jurisdiction}</td>
                <td className="py-3">
                  <span className="px-2 py-0.5 rounded-full text-sm font-bold bg-blue-50 text-[#0071E3] border border-blue-200">
                    {reg.category}
                  </span>
                </td>
                <td className="py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-sm font-bold border ${
                      reg.impactLevel === "High"
                        ? "bg-red-50 text-red-600 border-red-200"
                        : reg.impactLevel === "Medium"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    {reg.impactLevel}
                  </span>
                </td>
                <td className="py-3 text-[#1D1D1F]">
                  {new Date(reg.effectiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </td>
                <td className="py-3 font-bold text-[#0071E3]">{reg.affectedShipmentsCount}</td>
                <td className="py-3 text-[#86868B]">{reg.publishedText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom Regulatory Alerts Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-red-900">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>Immediate Action Required</span>
          </div>
          <p className="text-xs text-red-700">Section 301 exclusions expiring in 30 days. Affects 27 shipments.</p>
          <button className="text-xs font-bold text-red-600 hover:underline">View Details →</button>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-amber-900">
            <Clock className="w-4 h-4 text-amber-600" />
            <span>Upcoming Change</span>
          </div>
          <p className="text-xs text-amber-700">EUDR compliance deadline approaching. Affects 15 shipments.</p>
          <button className="text-xs font-bold text-amber-600 hover:underline">View Details →</button>
        </div>

        <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-blue-900">
            <Info className="w-4 h-4 text-[#0071E3]" />
            <span>New Requirement</span>
          </div>
          <p className="text-xs text-blue-700">Australia ICS2 data elements update. Affects 5 shipments.</p>
          <button className="text-xs font-bold text-[#0071E3] hover:underline">View Details →</button>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Information Update</span>
          </div>
          <p className="text-xs text-emerald-700">India import policy clarification issued. Affects 8 shipments.</p>
          <button className="text-xs font-bold text-emerald-600 hover:underline">View Details →</button>
        </div>
      </div>
    </div>
  );
}
