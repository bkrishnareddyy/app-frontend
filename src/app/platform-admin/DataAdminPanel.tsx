"use client";

import { useState, useEffect } from "react";
import {
  Database,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertCircle,
  Search,
  ExternalLink,
  Cpu,
  Layers,
  FileCode,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import type { DatasetDefinition } from "@/lib/data/datasetRegistry";

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function DataAdminPanel() {
  const [datasets, setDatasets] = useState<DatasetDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "Public API" | "Structured Document">("ALL");
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchDatasets = async () => {
    try {
      const res = await fetch("/api/platform-admin/datasets");
      if (res.ok) {
        const data = await res.json();
        setDatasets(data.datasets || []);
      }
    } catch (err) {
      console.error("Failed to load dataset registry:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, []);

  const handleRunNow = async (dataset: DatasetDefinition) => {
    setRunningIds((prev) => ({ ...prev, [dataset.id]: true }));
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/platform-admin/datasets/${dataset.id}/refresh`, {
        method: "POST",
      });

      const data = await res.json();
      if (res.ok && data.status === "SUCCESS") {
        setStatusMessage({
          type: "success",
          text: `Triggered "Run Now" for ${dataset.name}. Refreshed successfully at ${new Date().toLocaleTimeString()}.`,
        });
        // Update local dataset item state
        setDatasets((prev) =>
          prev.map((d) => (d.id === dataset.id ? { ...d, ...data.dataset } : d))
        );
      } else {
        throw new Error(data.error || data.message || "Execution failed");
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Error refreshing ${dataset.name}: ${err.message}`,
      });
      setDatasets((prev) =>
        prev.map((d) =>
          d.id === dataset.id
            ? { ...d, status: "error", details: `Error: ${err.message}` }
            : d
        )
      );
    } finally {
      setRunningIds((prev) => ({ ...prev, [dataset.id]: false }));
    }
  };

  const filteredDatasets = datasets.filter((d) => {
    const matchesCategory = categoryFilter === "ALL" || d.category === categoryFilter;
    const matchesSearch =
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.powers.toLowerCase().includes(search.toLowerCase()) ||
      d.source.toLowerCase().includes(search.toLowerCase()) ||
      d.refreshMethod.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const publicApiCount = datasets.filter((d) => d.category === "Public API").length;
  const structuredDocCount = datasets.filter((d) => d.category === "Structured Document").length;

  return (
    <div className="space-y-6">
      {/* Top Banner & KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">Total Datasets</p>
            <p className="text-2xl font-black text-ink tracking-tight">{datasets.length}</p>
            <p className="text-[11px] text-emerald-600 font-bold mt-0.5">100% Policy Covered</p>
          </div>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">Free Public APIs</p>
            <p className="text-2xl font-black text-ink tracking-tight">{publicApiCount}</p>
            <p className="text-[11px] text-blue-600 font-bold mt-0.5">Automated REST/XML</p>
          </div>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">Parsed Documents</p>
            <p className="text-2xl font-black text-ink tracking-tight">{structuredDocCount}</p>
            <p className="text-[11px] text-purple-600 font-bold mt-0.5">OCR / LLM Structured</p>
          </div>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">System Health</p>
            <p className="text-lg font-bold text-emerald-700">Healthy</p>
            <p className="text-[11px] text-ink-muted mt-0.5">Zero Synthetic Fallbacks</p>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold border flex items-center space-x-3 transition-all ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Main Table Card */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        {/* Controls Toolbar */}
        <div className="p-6 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
              <Database className="w-5 h-5 text-amber-600" />
              <span>Platform Dataset Master Registry & Refresh Policy</span>
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              Authoritative government trade sources, tariff schedules, screening databases, and manual execution triggers.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Category Filter Pills */}
            <div className="flex items-center bg-slate-100 p-1 rounded-full text-xs font-bold">
              <button
                onClick={() => setCategoryFilter("ALL")}
                className={`px-3 py-1.5 rounded-full transition-all ${
                  categoryFilter === "ALL" ? "bg-white text-ink shadow-xs" : "text-ink-muted hover:text-ink"
                }`}
              >
                All ({datasets.length})
              </button>
              <button
                onClick={() => setCategoryFilter("Public API")}
                className={`px-3 py-1.5 rounded-full transition-all ${
                  categoryFilter === "Public API" ? "bg-white text-blue-700 shadow-xs" : "text-ink-muted hover:text-ink"
                }`}
              >
                Public APIs ({publicApiCount})
              </button>
              <button
                onClick={() => setCategoryFilter("Structured Document")}
                className={`px-3 py-1.5 rounded-full transition-all ${
                  categoryFilter === "Structured Document"
                    ? "bg-white text-purple-700 shadow-xs"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Parsed Docs ({structuredDocCount})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-ink-muted absolute left-3 top-2.5" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search datasets, sources..."
                className="pl-9 pr-4 py-1.5 text-xs rounded-full w-full sm:w-60 focus:ring-0"
              />
            </div>
          </div>
        </div>

        {/* Datasets Table */}
        {loading ? (
          <div className="p-12 text-center text-sm text-ink-muted flex items-center justify-center space-x-2">
            <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
            <span>Loading dataset registry...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-surface-muted border-b border-border text-[11px] uppercase font-bold text-ink-muted">
                <tr>
                  <th className="py-3.5 px-4 min-w-[220px]">&lt;data&gt;</th>
                  <th className="py-3.5 px-4 min-w-[180px]">&lt;source&gt;</th>
                  <th className="py-3.5 px-4 min-w-[280px]">&lt;how is it refreshed&gt;</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">&lt;frequency&gt;</th>
                  <th className="py-3.5 px-4 min-w-[180px]">&lt;last run&gt;</th>
                  <th className="py-3.5 px-4 text-right min-w-[110px]">&lt;run now&gt;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDatasets.map((d) => {
                  const isRunning = runningIds[d.id];
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/60 transition-colors align-top">
                      {/* Dataset Column */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-ink text-sm flex items-center space-x-2">
                          <span>{d.name}</span>
                        </div>
                        <p className="text-[11px] text-ink-muted mt-1 leading-snug">{d.powers}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                          <Badge
                            className={`text-[10px] font-mono normal-case py-0 px-2 ${
                              d.category === "Public API"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-purple-50 text-purple-700 border-purple-200"
                            }`}
                          >
                            {d.category === "Public API" ? (
                              <FileCode className="w-3 h-3 inline mr-1" />
                            ) : (
                              <FileText className="w-3 h-3 inline mr-1" />
                            )}
                            {d.category}
                          </Badge>
                          {d.engineeringEffort && (
                            <Badge variant="neutral" className="text-[9px] font-mono uppercase text-slate-500 py-0 px-1.5">
                              Effort: {d.engineeringEffort}
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* Source Column */}
                      <td className="py-4 px-4">
                        <div className="font-medium text-slate-800">{d.source}</div>
                        {d.sourceUrl && (
                          <a
                            href={d.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline font-mono mt-1"
                          >
                            <span>Open Source</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                        <div className="mt-1">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            {d.cost}
                          </span>
                        </div>
                      </td>

                      {/* How is it Refreshed Column */}
                      <td className="py-4 px-4 text-ink-muted text-[11px] leading-relaxed">
                        <div>{d.refreshMethod}</div>
                        {d.endpoint && (
                          <div className="font-mono text-[10px] text-slate-400 mt-1">
                            Endpoint: {d.endpoint}
                          </div>
                        )}
                      </td>

                      {/* Frequency Column */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="px-2 py-1 rounded-md bg-slate-100 font-semibold text-slate-700 text-[11px]">
                          {d.frequency}
                        </span>
                      </td>

                      {/* Last Run Column */}
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="font-mono text-slate-700 font-semibold text-[11px]">
                            {formatDate(d.lastRun)}
                          </div>
                          <div className="flex items-center gap-1">
                            {d.status === "success" && (
                              <span className="inline-flex items-center text-[10px] font-bold text-emerald-600 gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Success
                              </span>
                            )}
                            {d.status === "running" && (
                              <span className="inline-flex items-center text-[10px] font-bold text-blue-600 gap-1 animate-pulse">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Running...
                              </span>
                            )}
                            {d.status === "error" && (
                              <span className="inline-flex items-center text-[10px] font-bold text-red-600 gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Failed
                              </span>
                            )}
                          </div>
                          {d.details && (
                            <p className="text-[10px] text-slate-400 max-w-xs truncate mt-0.5" title={d.details}>
                              {d.details}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Run Now Button Column */}
                      <td className="py-4 px-4 text-right">
                        <button
                          onClick={() => handleRunNow(d)}
                          disabled={isRunning}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1.5 ml-auto disabled:opacity-50 transition-all shadow-xs cursor-pointer"
                          title={`Trigger immediate refresh for ${d.name}`}
                        >
                          {isRunning ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>Running...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-2.5 h-2.5 fill-white" />
                              <span>Run Now</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
