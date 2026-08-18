"use client";

import React, { useState } from "react";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "@/lib/billing/telemetry";

interface RuleItem {
  id: string;
  lineItemName: string;
  pricingModel: string;
  rate: number;
  mappedEvents: string[];
}

export function MappingClient({ rules }: { rules: RuleItem[] }) {
  const [ruleMappings, setRuleMappings] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const r of rules) {
      initial[r.id] = r.mappedEvents.length > 0 ? r.mappedEvents : [DEFAULT_BILLING_EVENT_DEFINITIONS[0].eventCode];
    }
    return initial;
  });

  const toggleEventMapping = (ruleId: string, eventCode: string) => {
    const current = ruleMappings[ruleId] ?? [];
    if (current.includes(eventCode)) {
      setRuleMappings({ ...ruleMappings, [ruleId]: current.filter((c) => c !== eventCode) });
    } else {
      setRuleMappings({ ...ruleMappings, [ruleId]: [...current, eventCode] });
    }
  };

  return (
    <div className="space-y-6">
      {rules.map((rule) => {
        const mapped = ruleMappings[rule.id] ?? [];
        return (
          <div key={rule.id} className="p-5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-ink">{rule.lineItemName}</h4>
                <p className="text-xs text-ink-muted">
                  Pricing Model: <span className="font-mono text-ink">{rule.pricingModel}</span> | Rate:{" "}
                  <span className="font-mono text-emerald-600 font-semibold">${rule.rate.toFixed(2)}</span>
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-brand border border-blue-200">
                {mapped.length} Event(s) Mapped
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                Select Qubere Platform APIs / Capabilities that trigger this customer charge:
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEFAULT_BILLING_EVENT_DEFINITIONS.map((def) => {
                  const isChecked = mapped.includes(def.eventCode);
                  return (
                    <label
                      key={def.eventCode}
                      className={`p-3 rounded-lg border text-xs cursor-pointer transition-all flex items-start gap-3 ${
                        isChecked
                          ? "bg-white border-brand shadow-sm text-ink"
                          : "bg-white/60 border-[#E5E5EA] text-ink-muted hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleEventMapping(rule.id, def.eventCode)}
                        className="mt-0.5 rounded border-slate-300 text-brand focus:ring-brand"
                      />
                      <div className="space-y-0.5">
                        <div className="font-bold text-ink">{def.name}</div>
                        <div className="font-mono text-[10px] text-ink-muted">{def.eventCode}</div>
                        <div className="text-[10px] text-slate-500">{def.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      <div className="pt-4 border-t border-[#E5E5EA] flex justify-end">
        <button
          type="button"
          onClick={() => alert("Capability mappings saved successfully!")}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm"
        >
          Save Platform Capability Mappings
        </button>
      </div>
    </div>
  );
}
