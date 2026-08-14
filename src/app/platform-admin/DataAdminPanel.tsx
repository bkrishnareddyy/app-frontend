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
  FileCode,
  FileText,
  Clock,
  Construction,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import type { DatasetWithStatus } from "@/lib/data/datasetRegistry";

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function DataAdminPanel() {
  const [datasets, setDatasets] = useState<DatasetWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "Public API" | "Structured Document">("ALL");
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const fetchDatasets = async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/platform-admin/datasets");
      if (res.ok) {
        const data = await res.json();
        setDatasets(data.datasets || []);
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
        setLoadError(`Failed to load datasets: ${msg}`);
        console.error("Dataset registry API error:", res.status, data);
      }
    } catch (err: any) {
      setLoadError(`Network error: ${err.message}`);
      console.error("Failed to load dataset registry:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, []);

  const handleRunNow = async (dataset: DatasetWithStatus) => {
    // Guard: not-yet-implemented datasets cannot be run
    if (dataset.readinessStatus === "NOT_YET_IMPLEMENTED") {
      setStatusMessage({
        type: "info",
        text: `"${dataset.name}" ingestion is not yet implemented. No data will be fetched. This dataset is on the engineering roadmap.`,
      });
      return;
    }

    setRunningIds((prev) => ({ ...prev, [dataset.id]: true }));
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/platform-admin/datasets/${dataset.id}/refresh`, {
        method: "POST",
      });
      const data = await res.json();

      if (res.status === 422) {
        setStatusMessage({ type: "info", text: data.message });
        return;
      }

      if (res.ok && data.status === "SUCCESS") {
        setStatusMessage({
          type: "success",
          text: `"${dataset.name}" refreshed. ${data.message}`,
        });
        // Reload to get real DB state
        await fetchDatasets();
      } else {
        throw new Error(data.error || data.message || "Execution failed");
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Error refreshing ${dataset.name}: ${err.message}`,
      });
    } finally {
      setRunningIds((prev) => ({ ...prev, [dataset.id]: false }));
    }
  };

  const liveCount = datasets.filter((d) => d.readinessStatus === "LIVE").length;
  const notYetCount = datasets.filter((d) => d.readinessStatus === "NOT_YET_IMPLEMENTED").length;
  const publicApiCount = datasets.filter((d) => d.category === "Public API").length;
  const structuredDocCount = datasets.filter((d) => d.category === "Structured Document").length;

  const filteredDatasets = datasets.filter((d) => {
    const matchesCategory = categoryFilter === "ALL" || d.category === categoryFilter;
    const matchesSearch =
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.powers.toLowerCase().includes(search.toLowerCase()) ||
      d.source.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">Total Datasets</p>
            <p className="text-2xl font-black text-ink tracking-tight">{datasets.length}</p>
            <p className="text-[11px] text-ink-muted mt-0.5">18 required</p>
          </div>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">Live Ingestion</p>
            <p className="text-2xl font-black text-emerald-700 tracking-tight">{liveCount}</p>
            <p className="text-[11px] text-emerald-600 font-bold mt-0.5">Real data wired</p>
          </div>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
            <Construction className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">On Roadmap</p>
            <p className="text-2xl font-black text-amber-700 tracking-tight">{notYetCount}</p>
            <p className="text-[11px] text-amber-600 font-bold mt-0.5">Not yet wired</p>
          </div>
        </div>

        <div className="apple-card p-5 rounded-3xl border border-border bg-white shadow-sm flex items-center space-x-4">
          <div className="p-3 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-ink-muted font-medium">Free Public APIs</p>
            <p className="text-2xl font-black text-ink tracking-tight">{publicApiCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{structuredDocCount} parsed docs</p>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold border flex items-start space-x-3 transition-all ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : statusMessage.type === "info"
              ? "bg-blue-50 border-blue-200 text-blue-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : statusMessage.type === "info" ? (
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Notice about roadmap datasets */}
      <div className="flex items-start space-x-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <Construction className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <span>
          <strong>Engineering Roadmap:</strong> {notYetCount} of {datasets.length} datasets are documented and planned
          but ingestion pipelines are not yet wired. &quot;Run Now&quot; is only available for
          <strong> LIVE</strong> datasets. Roadmap datasets show their planned source, parsing strategy,
          and schema tables — no synthetic data is ever returned.
        </span>
      </div>

      {/* Main Table */}
      <div className="apple-card rounded-3xl border border-border bg-white shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-6 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
              <Database className="w-5 h-5 text-amber-600" />
              <span>Platform Dataset Master Registry</span>
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              Authoritative government trade sources, tariff schedules, and screening databases. Last-run state from DatasetRefreshLog DB table.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
                  categoryFilter === "Public API"
                    ? "bg-white text-blue-700 shadow-xs"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                APIs ({publicApiCount})
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

            <div className="relative">
              <Search className="w-4 h-4 text-ink-muted absolute left-3 top-2.5" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search datasets..."
                className="pl-9 pr-4 py-1.5 text-xs rounded-full w-full sm:w-60 focus:ring-0"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-ink-muted flex items-center justify-center space-x-2">
            <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
            <span>Loading dataset registry...</span>
          </div>
        ) : loadError ? (
          <div className="p-12 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-sm font-semibold text-red-700">{loadError}</p>
            <button
              onClick={fetchDatasets}
              className="text-xs text-brand underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        ) : filteredDatasets.length === 0 && datasets.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Database className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-ink-muted">No datasets found. The registry may still be loading.</p>
            <button
              onClick={fetchDatasets}
              className="text-xs text-brand underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-surface-muted border-b border-border text-[11px] uppercase font-bold text-ink-muted">
                <tr>
                  <th className="py-3.5 px-4 min-w-[220px]">&lt;data&gt;</th>
                  <th className="py-3.5 px-4 min-w-[160px]">&lt;source&gt;</th>
                  <th className="py-3.5 px-4 min-w-[260px]">&lt;how is it refreshed&gt;</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">&lt;frequency&gt;</th>
                  <th className="py-3.5 px-4 min-w-[170px]">&lt;last run&gt;</th>
                  <th className="py-3.5 px-4 text-right min-w-[130px]">&lt;run now&gt;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDatasets.map((d) => {
                  const isRunning = runningIds[d.id];
                  const isLive = d.readinessStatus === "LIVE";

                  return (
                    <tr
                      key={d.id}
                      className={`hover:bg-slate-50/60 transition-colors align-top ${
                        !isLive ? "bg-amber-50/30" : ""
                      }`}
                    >
                      {/* Dataset Column */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-ink text-sm">{d.name}</div>
                        <p className="text-[11px] text-ink-muted mt-1 leading-snug">{d.powers}</p>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {/* Live vs Roadmap badge */}
                          {isLive ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-2.5 h-2.5" /> LIVE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <Construction className="w-2.5 h-2.5" /> Roadmap
                            </span>
                          )}
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
                          <Badge variant="neutral" className="text-[9px] font-mono uppercase text-slate-500 py-0 px-1.5">
                            Effort: {d.engineeringEffort}
                          </Badge>
                        </div>
                      </td>

                      {/* Source Column */}
                      <td className="py-4 px-4">
                        <div className="font-medium text-slate-800 text-[11px]">{d.source}</div>
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

                      {/* How Refreshed Column */}
                      <td className="py-4 px-4 text-ink-muted text-[11px] leading-relaxed">
                        <div>{d.refreshMethod}</div>
                        {d.endpoint && (
                          <div className="font-mono text-[10px] text-slate-400 mt-1">
                            → {d.endpoint}
                          </div>
                        )}
                      </td>

                      {/* Frequency Column */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="px-2 py-1 rounded-md bg-slate-100 font-semibold text-slate-700 text-[11px] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {d.frequency}
                        </span>
                      </td>

                      {/* Last Run Column */}
                      <td className="py-4 px-4">
                        {isLive ? (
                          <div className="space-y-1">
                            <div className="font-mono text-slate-700 font-semibold text-[11px]">
                              {d.lastRun ? formatDate(d.lastRun) : "Never run"}
                            </div>
                            <div className="flex items-center gap-1">
                              {d.lastRunStatus === "success" && (
                                <span className="inline-flex items-center text-[10px] font-bold text-emerald-600 gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> Success
                                </span>
                              )}
                              {d.lastRunStatus === "running" && (
                                <span className="inline-flex items-center text-[10px] font-bold text-blue-600 gap-1 animate-pulse">
                                  <RefreshCw className="w-3 h-3 animate-spin" /> Running...
                                </span>
                              )}
                              {d.lastRunStatus === "error" && (
                                <span className="inline-flex items-center text-[10px] font-bold text-red-600 gap-1">
                                  <AlertCircle className="w-3 h-3" /> Failed
                                </span>
                              )}
                              {!d.lastRunStatus && (
                                <span className="text-[10px] text-slate-400">Not yet executed</span>
                              )}
                            </div>
                            {d.lastRunDetails && (
                              <p
                                className="text-[10px] text-slate-400 max-w-xs truncate"
                                title={d.lastRunDetails}
                              >
                                {d.lastRunDetails}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-amber-600 font-semibold italic">
                            Pipeline not wired
                          </span>
                        )}
                      </td>

                      {/* Run Now Column */}
                      <td className="py-4 px-4 text-right">
                        {isLive ? (
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
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl ml-auto cursor-default">
                            <Construction className="w-3 h-3" />
                            On Roadmap
                          </span>
                        )}
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
