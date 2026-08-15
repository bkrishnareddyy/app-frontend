"use client";

import { useState } from "react";
import {
  Globe,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { displayCurrency } from "@/lib/honest";

interface RegulatoryUpdate {
  id: string;
  title: string;
  description: string;
  jurisdiction: string;
  category: string;
  impactLevel: string;
  effectiveDate: string;
  affectedShipmentsCount: number | null;
  publishedText: string | null;
  status: string;
  documentNumber: string | null;
  metadata: any;
}

interface RegulatoryClientProps {
  initialUpdates: RegulatoryUpdate[];
}

export function RegulatoryClient({ initialUpdates }: RegulatoryClientProps) {
  const [updates, setUpdates] = useState<RegulatoryUpdate[]>(initialUpdates);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterActionRequired, setFilterActionRequired] = useState<boolean>(false);
  const [searchHts, setSearchHts] = useState<string>("");

  // Impact Analysis state
  const [selectedUpdate, setSelectedUpdate] = useState<RegulatoryUpdate | null>(null);
  const [impactData, setImpactData] = useState<any | null>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState<boolean>(false);
  const [page, setPage] = useState(1);

  // Trigger impact analysis calculation
  const triggerImpactAnalysis = async (updateId: string) => {
    setIsLoadingImpact(true);
    try {
      const res = await fetch(`/api/regulatory/${updateId}/impact-analysis`, { method: "POST" });
      const data = await res.json();
      
      // Update local count
      setUpdates((prev) =>
        prev.map((u) =>
          u.id === updateId
            ? { ...u, affectedShipmentsCount: data.impactSummary?.shipmentsAffected ?? 0 }
            : u
        )
      );

      // Fetch details
      await fetchImpactDetails(updateId, 1);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingImpact(false);
    }
  };

  const fetchImpactDetails = async (updateId: string, pageNum: number) => {
    try {
      const res = await fetch(`/api/regulatory/${updateId}/impacted?page=${pageNum}&limit=5`);
      const data = await res.json();
      setImpactData(data);
      setPage(pageNum);
    } catch (e) {
      console.error(e);
    }
  };

  const handleViewImpact = async (update: RegulatoryUpdate) => {
    setSelectedUpdate(update);
    setImpactData(null);
    await triggerImpactAnalysis(update.id);
  };

  // Filter logic
  const filteredUpdates = updates.filter((u) => {
    const meta = u.metadata || {};
    if (filterType !== "ALL" && meta.type !== filterType) return false;
    if (filterActionRequired && !meta.actionRequired) return false;
    if (searchHts) {
      const htsCodes = meta.affectedHtsCodes || [];
      const matches = htsCodes.some((code: string) => code.includes(searchHts));
      if (!matches) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-border shadow-2xs">
        <div>
          <div className="flex items-center space-x-2">
            <Globe className="w-5 h-5 text-brand" />
            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Regulatory Intelligence & Analytics</h1>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Real-time regulatory monitoring, policy impact assessment and landed cost scenario comparisons.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Filter HTS..."
            value={searchHts}
            onChange={(e) => setSearchHts(e.target.value)}
            className="pl-3 pr-3 py-1.5 bg-white border border-border rounded-xl text-xs text-ink w-40"
          />

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-1.5 bg-white border border-border rounded-xl text-xs text-ink"
          >
            <option value="ALL">All Types</option>
            <option value="TARIFF_RATE_CHANGE">Tariff Changes</option>
            <option value="EXCLUSION_GRANTED">Exclusions</option>
            <option value="POLICY">Policy Updates</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-ink font-semibold">
            <input
              type="checkbox"
              checked={filterActionRequired}
              onChange={(e) => setFilterActionRequired(e.target.checked)}
              className="rounded border-border text-brand focus:ring-brand"
            />
            <span>Action Required</span>
          </label>
        </div>
      </div>

      {/* Main Content Split: Updates Feed & Impact Analysis Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Feed of Updates */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-border shadow-2xs space-y-4">
            <h3 className="text-sm font-extrabold text-slate-800">CBP & Trade Regulatory Updates Feed</h3>
            
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto pr-2 space-y-4">
              {filteredUpdates.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">No matching regulatory updates found.</p>
              ) : (
                filteredUpdates.map((reg) => (
                  <div key={reg.id} className="pt-4 first:pt-0 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-bold text-slate-700">
                          {reg.category}
                        </span>
                        {reg.status === "Action Required" && (
                          <span className="px-2 py-0.5 bg-red-50 border border-red-200 rounded text-[9px] font-bold text-red-600">
                            Action Required
                          </span>
                        )}
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">{reg.title}</h4>
                      <p className="text-[11px] text-slate-500">{reg.description}</p>
                      <p className="text-[10px] text-slate-400">
                        Effective: {new Date(reg.effectiveDate).toLocaleDateString()} | Document: {reg.documentNumber || "N/A"}
                      </p>
                    </div>

                    <button
                      onClick={() => handleViewImpact(reg)}
                      className="px-3 py-1.5 bg-white hover:bg-brand/5 border border-border hover:border-brand text-brand font-bold rounded-lg text-[11px] shrink-0 cursor-pointer transition-all"
                    >
                      Assess Impact
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Impact Workspace */}
        <div className="lg:col-span-5">
          <div className="bg-white p-6 rounded-2xl border border-border shadow-2xs min-h-[400px] flex flex-col">
            {!selectedUpdate ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <Globe className="w-12 h-12 text-slate-300 mb-3" />
                <h4 className="text-sm font-bold text-slate-800">Impact Analysis Workspace</h4>
                <p className="text-xs text-slate-500 max-w-xs mt-1">Select a regulatory update from the feed to compute product and shipment exposure.</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-[9px] font-bold text-indigo-700">
                    {selectedUpdate.metadata?.type?.replace(/_/g, " ") || "Regulatory Change"}
                  </span>
                  <h4 className="text-sm font-bold text-slate-800 mt-1">{selectedUpdate.title}</h4>
                </div>

                {isLoadingImpact ? (
                  <div className="flex-1 flex items-center justify-center p-8">
                    <span className="text-xs text-slate-500 animate-pulse">Running exposure calculations...</span>
                  </div>
                ) : impactData ? (
                  <div className="space-y-4 flex-1 flex flex-col">
                    {/* Stats Header */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="text-[10px] text-slate-500 font-semibold block uppercase">Affected Shipments</span>
                        <span className="text-base font-extrabold text-slate-800">{impactData.pagination.totalShipments}</span>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="text-[10px] text-slate-500 font-semibold block uppercase">Estimated Duty Delta</span>
                        <span className="text-base font-extrabold text-red-600">
                          +{displayCurrency(
                            impactData.shipments.reduce((sum: number, s: any) => sum + s.dutyDelta, 0),
                            "USD"
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Impact Details Tabs */}
                    <div className="flex-1 flex flex-col min-h-0 space-y-3">
                      <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1">Affected Shipments List</h5>
                      
                      {impactData.shipments.length === 0 ? (
                        <p className="text-xs text-slate-500">No active shipments affected by this HTS revision.</p>
                      ) : (
                        <div className="divide-y divide-slate-100 flex-1 overflow-y-auto">
                          {impactData.shipments.map((s: any) => (
                            <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                              <div>
                                <p className="font-bold text-slate-800">{s.shipmentNumber}</p>
                                <p className="text-[10px] text-slate-400">Customs Val: {displayCurrency(s.customsValue, "USD")}</p>
                              </div>
                              <span className="font-extrabold text-red-600">+{displayCurrency(s.dutyDelta, "USD")}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Pagination */}
                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                        <span>
                          Showing {Math.min(impactData.shipments.length, 5)} of {impactData.pagination.totalShipments} shipments
                        </span>

                        <div className="flex gap-2">
                          <button
                            disabled={page === 1}
                            onClick={() => fetchImpactDetails(selectedUpdate.id, page - 1)}
                            className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            disabled={page * 5 >= impactData.pagination.totalShipments}
                            onClick={() => fetchImpactDetails(selectedUpdate.id, page + 1)}
                            className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => triggerImpactAnalysis(selectedUpdate.id)}
                    className="w-full py-2 bg-brand text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Trigger Impact Analysis Run</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
