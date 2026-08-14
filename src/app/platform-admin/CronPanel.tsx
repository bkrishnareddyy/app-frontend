"use client";

import { useState } from "react";
import { Clock, Play, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

interface CronJob {
  id: string;
  name: string;
  endpoint: string;
  method: "GET" | "POST";
  schedule: string;
  lastRun: string;
  status: "idle" | "running" | "success" | "error";
  details?: string;
}

export function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([
    {
      id: "regulatory-ingest",
      name: "Regulatory Notice Ingestion",
      endpoint: "/api/cron/regulatory-ingest",
      method: "POST",
      schedule: "Daily at 08:00 UTC (via HTS Refresh) / Manual",
      lastRun: "Never",
      status: "idle",
    },
    {
      id: "hts-refresh",
      name: "HTS Schedule Refresh",
      endpoint: "/api/cron/hts-refresh",
      method: "POST",
      schedule: "0 2 * * * (Daily at 02:00 UTC)",
      lastRun: "Never",
      status: "idle",
    },
    {
      id: "deadline-sweep",
      name: "Compliance Deadline Sweep",
      endpoint: "/api/cron/deadline-sweep",
      method: "GET",
      schedule: "*/15 * * * * (Every 15 minutes)",
      lastRun: "Never",
      status: "idle",
    },
    {
      id: "document-processing",
      name: "Document Processing Pipeline",
      endpoint: "/api/cron/document-processing",
      method: "GET",
      schedule: "Daily Backstop Tick (On-demand/1h)",
      lastRun: "Never",
      status: "idle",
    },
    {
      id: "inbound-email-processing",
      name: "Inbound Email Processing Backstop",
      endpoint: "/api/cron/inbound-email-processing",
      method: "GET",
      schedule: "Daily Backstop Tick (On-demand/1h)",
      lastRun: "Never",
      status: "idle",
    },
  ]);

  const runJobManually = async (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "running" } : j))
    );

    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    try {
      const res = await fetch(job.endpoint, { method: job.method });
      const data = await res.json();

      if (res.ok) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: "success",
                  lastRun: new Date().toLocaleTimeString(),
                  details: `Result: ${JSON.stringify(data)}`,
                }
              : j
          )
        );
      } else {
        throw new Error(data.message || data.error || "Failed to trigger execution");
      }
    } catch (err: any) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "error",
                details: err.message || "Internal Server Error",
              }
            : j
        )
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="apple-card p-6 rounded-3xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
              <Clock className="w-5 h-5 text-brand" />
              <span>Cron Jobs & Background Worker Pipeline</span>
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              Trigger, monitor, and configure system automation tasks, regulatory checks, and document parsers.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-ink-muted font-bold">
                <th className="py-3 px-4">Job Name</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Schedule</th>
                <th className="py-3 px-4">Last Run Status / Timestamp</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50/50">
                  <td className="py-3.5 px-4 font-bold text-ink">
                    <div>{job.name}</div>
                    <span className="text-[10px] text-slate-400 font-semibold">{job.endpoint}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      job.method === "POST" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-purple-50 text-purple-700 border border-purple-200"
                    }`}>
                      {job.method}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-ink-muted">{job.schedule}</td>
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <span className="font-semibold text-slate-700 block">{job.lastRun}</span>
                      {job.details && (
                        <p className="text-[10px] text-slate-400 max-w-xs truncate" title={job.details}>
                          {job.details}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end space-x-3">
                      {job.status === "running" && (
                        <span className="flex items-center text-[10px] font-bold text-slate-500 gap-1 animate-pulse">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Running...
                        </span>
                      )}
                      {job.status === "success" && (
                        <span className="flex items-center text-[10px] font-bold text-emerald-600 gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Success
                        </span>
                      )}
                      {job.status === "error" && (
                        <span className="flex items-center text-[10px] font-bold text-red-600 gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Error
                        </span>
                      )}
                      <button
                        onClick={() => runJobManually(job.id)}
                        disabled={job.status === "running"}
                        className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white text-[11px] font-bold rounded-lg flex items-center gap-1 disabled:opacity-50 cursor-pointer transition-all"
                      >
                        <Play className="w-2.5 h-2.5 fill-white" />
                        <span>Run Manually</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
