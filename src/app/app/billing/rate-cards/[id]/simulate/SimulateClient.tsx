"use client";

import React, { useState, useTransition } from "react";
import { runRateSimulationAction } from "./actions";
import type { SimulationSummary } from "@/lib/billing/rateSimulation";

interface Props {
  rateCardVersionId: string;
  rateCardName: string;
}

const MONTH_OPTIONS = [1, 3, 6, 12, 24];

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-muted">$0.00</span>;
  const cls = value > 0 ? "text-emerald-700" : "text-rose-700";
  return <span className={cls}>{value > 0 ? "+" : ""}${value.toFixed(2)}</span>;
}

function PctBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  const cls = value > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : value < 0 ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {value > 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

export function SimulateClient({ rateCardVersionId, rateCardName }: Props) {
  const [months, setMonths] = useState(3);
  const [result, setResult] = useState<SimulationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRun = () => {
    setError(null);
    startTransition(async () => {
      try {
        const summary = await runRateSimulationAction(rateCardVersionId, months);
        setResult(summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Simulation failed");
      }
    });
  };

  const clientRows = result
    ? Object.entries(result.byClient).sort(([, a], [, b]) => b.proposed - a.proposed)
    : [];
  const serviceRows = result
    ? Object.entries(result.byService).sort(([, a], [, b]) => b.proposed - a.proposed)
    : [];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="p-5 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-ink">Simulation Parameters</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Historical Window</label>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand bg-white"
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm disabled:opacity-50"
          >
            {isPending ? "Running simulation…" : "Run Simulation"}
          </button>
        </div>
        <p className="text-[11px] text-ink-muted">
          Applies <span className="font-semibold">{rateCardName}</span>&apos;s proposed rules to the last {months} months of actual usage events,
          without writing any charges. Delta = proposed revenue − actual revenue billed.
        </p>
        {error && <div className="text-xs font-semibold text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200">{error}</div>}
      </div>

      {result && (
        <>
          {/* Top-line summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Proposed Revenue", value: `$${result.proposedRevenue.toFixed(2)}`, sub: null },
              { label: "Actual Revenue", value: `$${result.actualRevenue.toFixed(2)}`, sub: null },
              { label: "Revenue Delta", value: <DeltaBadge value={result.delta} />, sub: null },
              { label: "Change", value: <PctBadge value={result.deltaPercent} />, sub: `${result.matchedCount} / ${result.eventCount} events matched` },
            ].map(({ label, value, sub }) => (
              <div key={label} className="p-4 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm">
                <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">{label}</div>
                <div className="text-lg font-bold mt-1 text-ink">{value}</div>
                {sub && <div className="text-[10px] text-ink-muted mt-0.5">{sub}</div>}
              </div>
            ))}
          </div>

          {/* Service breakdown */}
          {serviceRows.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-ink">By Service</h3>
              <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs text-ink">
                  <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-[10px] tracking-wider border-b border-[#E5E5EA]">
                    <tr>
                      <th className="px-5 py-3">Service</th>
                      <th className="px-5 py-3">Proposed</th>
                      <th className="px-5 py-3">Actual</th>
                      <th className="px-5 py-3">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E5EA] font-mono">
                    {serviceRows.map(([code, s]) => (
                      <tr key={code} className="hover:bg-[#F9F9FB] transition-colors">
                        <td className="px-5 py-3 font-sans font-semibold text-ink">{code}</td>
                        <td className="px-5 py-3 text-emerald-700">${s.proposed.toFixed(2)}</td>
                        <td className="px-5 py-3 text-ink-muted">${s.actual.toFixed(2)}</td>
                        <td className="px-5 py-3"><DeltaBadge value={s.delta} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Client breakdown */}
          {clientRows.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-ink">By Client / Importer</h3>
              <div className="rounded-2xl bg-white border border-[#E5E5EA] overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs text-ink">
                  <thead className="bg-[#F5F5F7] text-ink-muted uppercase text-[10px] tracking-wider border-b border-[#E5E5EA]">
                    <tr>
                      <th className="px-5 py-3">Client / Importer ID</th>
                      <th className="px-5 py-3">Proposed</th>
                      <th className="px-5 py-3">Actual</th>
                      <th className="px-5 py-3">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E5EA] font-mono">
                    {clientRows.map(([id, s]) => (
                      <tr key={id} className="hover:bg-[#F9F9FB] transition-colors">
                        <td className="px-5 py-3 font-sans text-ink-muted text-[10px]">{id}</td>
                        <td className="px-5 py-3 text-emerald-700">${s.proposed.toFixed(2)}</td>
                        <td className="px-5 py-3 text-ink-muted">${s.actual.toFixed(2)}</td>
                        <td className="px-5 py-3"><DeltaBadge value={s.delta} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.eventCount > 0 && result.matchedCount === 0 && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">
              No usage events in the selected window matched any rule in this rate card version.
              Check that capability mappings are configured for this version.
            </div>
          )}
        </>
      )}
    </div>
  );
}
