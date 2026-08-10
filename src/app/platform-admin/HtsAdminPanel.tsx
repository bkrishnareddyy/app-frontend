"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { Globe2, CheckCircle2, AlertCircle, Loader2, Clock, Database, FileClock } from "lucide-react";

export interface CountryVersion {
  country: string;
  releaseId: string;
  releaseName: string;
  publishedAt: string | null;
  effectiveFrom: string;
  rowCount: number;
}

export interface PendingDraft {
  releaseId: string;
  country: string;
  releaseName: string;
  retrievedAt: string;
  rowCount: number;
}

export interface HtsAdminData {
  countryVersions: CountryVersion[];
  pendingDrafts: PendingDraft[];
  totalRowCount: number;
  lastRefreshAt: string | null;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function HtsAdminPanel({ data }: { data: HtsAdminData }) {
  const router = useRouter();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handlePublish = async (releaseId: string, releaseName: string) => {
    setPublishingId(releaseId);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/hts/releases/${releaseId}/publish`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Published "${releaseName}".` });
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to publish release" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-4 rounded-2xl text-sm border flex items-center space-x-3 ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Summary stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="apple-card p-5 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center space-x-2 text-[#86868B] text-xs font-bold uppercase tracking-wider mb-2">
            <FileClock className="w-3.5 h-3.5" />
            <span>Last Data Refresh</span>
          </div>
          <p className="text-lg font-extrabold text-[#1D1D1F]">
            {data.lastRefreshAt ? formatDateTime(data.lastRefreshAt) : "Never"}
          </p>
          <p className="text-[10px] text-[#86868B] mt-1">
            Last time any release (staged or published) was ingested — not a heartbeat that the nightly job ran and found nothing.
          </p>
        </div>
        <div className="apple-card p-5 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center space-x-2 text-[#86868B] text-xs font-bold uppercase tracking-wider mb-2">
            <Database className="w-3.5 h-3.5" />
            <span>Total HS Rows (Published)</span>
          </div>
          <p className="text-lg font-extrabold text-[#1D1D1F]">{data.totalRowCount.toLocaleString()}</p>
          <p className="text-[10px] text-[#86868B] mt-1">Across all countries with a currently published schedule.</p>
        </div>
        <div className="apple-card p-5 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center space-x-2 text-[#86868B] text-xs font-bold uppercase tracking-wider mb-2">
            <Globe2 className="w-3.5 h-3.5" />
            <span>Countries Live</span>
          </div>
          <p className="text-lg font-extrabold text-[#1D1D1F]">
            {data.countryVersions.length > 0 ? data.countryVersions.map((c) => c.country).join(", ") : "None"}
          </p>
          <p className="text-[10px] text-[#86868B] mt-1">
            {data.countryVersions.length} of 1 currently supported by the ingestion pipeline (US-only for now).
          </p>
        </div>
      </div>

      {/* Per-country current version table */}
      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA]">
          <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
            <Globe2 className="w-5 h-5 text-amber-600" />
            <span>Live Schedules by Country</span>
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">The currently published HTS release for each country.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-xs uppercase font-bold text-[#86868B]">
              <tr>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Current Version</th>
                <th className="px-6 py-4">Published</th>
                <th className="px-6 py-4">Effective From</th>
                <th className="px-6 py-4">Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {data.countryVersions.map((c) => (
                <tr key={c.releaseId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold">{c.country}</td>
                  <td className="px-6 py-4">
                    <div className="font-semibold">{c.releaseName}</div>
                    <div className="text-[10px] font-mono text-[#86868B]">{c.releaseId}</div>
                  </td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">{c.publishedAt ? formatDateTime(c.publishedAt) : "—"}</td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">{formatDate(c.effectiveFrom)}</td>
                  <td className="px-6 py-4 text-xs font-mono">{c.rowCount.toLocaleString()}</td>
                </tr>
              ))}
              {data.countryVersions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[#86868B]">
                    No published HTS release for any country yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending drafts awaiting review */}
      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA]">
          <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span>Pending Review ({data.pendingDrafts.length})</span>
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Staged by the nightly refresh job or manual ingestion. Nothing here is live until published.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-xs uppercase font-bold text-[#86868B]">
              <tr>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Release</th>
                <th className="px-6 py-4">Staged</th>
                <th className="px-6 py-4">Rows</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {data.pendingDrafts.map((d) => (
                <tr key={d.releaseId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold">{d.country}</td>
                  <td className="px-6 py-4">
                    <div className="font-semibold">{d.releaseName}</div>
                    <div className="text-[10px] font-mono text-[#86868B]">{d.releaseId}</div>
                  </td>
                  <td className="px-6 py-4 text-xs text-[#86868B]">{formatDateTime(d.retrievedAt)}</td>
                  <td className="px-6 py-4 text-xs font-mono">{d.rowCount.toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handlePublish(d.releaseId, d.releaseName)}
                      disabled={publishingId === d.releaseId}
                      className="px-3 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full text-xs font-semibold shadow-2xs disabled:opacity-50 flex items-center space-x-1.5"
                    >
                      {publishingId === d.releaseId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>Publish</span>
                    </button>
                  </td>
                </tr>
              ))}
              {data.pendingDrafts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[#86868B]">
                    Nothing pending review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
