"use client";

import React, { useState, useTransition } from "react";
import { addDraftRateRuleAction, updateDraftRateRuleAction, deleteDraftRateRuleAction } from "../../actions";

const PRICING_MODELS = [
  "PER_UNIT", "PER_TRANSACTION", "PER_SHIPMENT", "PER_ENTRY", "PER_DOCUMENT",
  "PER_API_EVENT", "PER_SUCCESSFUL_OUTCOME", "FLAT_FEE", "TIERED", "TIME_BASED",
  "PERCENTAGE_BASED", "BUNDLED", "CONDITIONAL",
];

interface RuleItem {
  id: string;
  lineItemName: string;
  pricingModel: string;
  rate: number;
  mappedEvents: string[];
}

interface Props {
  versionId: string;
  rateCardId: string;
  currency: string;
  rules: RuleItem[];
}

interface EditingState {
  lineItemName: string;
  pricingModel: string;
  rate: string;
  unit: string;
  includedQuantity: string;
}

const DEFAULT_EDIT: EditingState = {
  lineItemName: "",
  pricingModel: "PER_UNIT",
  rate: "0",
  unit: "unit",
  includedQuantity: "0",
};

export function RateRuleEditor({ versionId, rateCardId: _rateCardId, currency, rules }: Props) {
  const [localRules, setLocalRules] = useState<RuleItem[]>(rules);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditingState>(DEFAULT_EDIT);
  const [adding, setAdding] = useState(false);
  const [addState, setAddState] = useState<EditingState>(DEFAULT_EDIT);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startEdit = (rule: RuleItem) => {
    setEditingId(rule.id);
    setEditState({
      lineItemName: rule.lineItemName,
      pricingModel: rule.pricingModel,
      rate: String(rule.rate),
      unit: "unit",
      includedQuantity: "0",
    });
    setError(null);
  };

  const saveEdit = (ruleId: string) => {
    startTransition(async () => {
      setError(null);
      try {
        await updateDraftRateRuleAction(ruleId, {
          lineItemName: editState.lineItemName,
          pricingModel: editState.pricingModel,
          rate: parseFloat(editState.rate),
          unit: editState.unit,
          includedQuantity: parseInt(editState.includedQuantity, 10) || 0,
        });
        setLocalRules((prev) =>
          prev.map((r) =>
            r.id === ruleId
              ? { ...r, lineItemName: editState.lineItemName, pricingModel: editState.pricingModel, rate: parseFloat(editState.rate) }
              : r
          )
        );
        setEditingId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update rule");
      }
    });
  };

  const deleteRule = (ruleId: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      setError(null);
      try {
        await deleteDraftRateRuleAction(ruleId);
        setLocalRules((prev) => prev.filter((r) => r.id !== ruleId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete rule");
      }
    });
  };

  const addRule = () => {
    startTransition(async () => {
      setError(null);
      try {
        const result = await addDraftRateRuleAction(versionId, {
          lineItemName: addState.lineItemName,
          serviceCode: addState.lineItemName.toUpperCase().replace(/\s+/g, "_"),
          pricingModel: addState.pricingModel,
          unit: addState.unit,
          rate: parseFloat(addState.rate),
          includedQuantity: parseInt(addState.includedQuantity, 10) || 0,
          currency,
        });
        setLocalRules((prev) => [
          ...prev,
          {
            id: result.ruleId,
            lineItemName: addState.lineItemName,
            pricingModel: addState.pricingModel,
            rate: parseFloat(addState.rate),
            mappedEvents: [],
          },
        ]);
        setAdding(false);
        setAddState(DEFAULT_EDIT);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add rule");
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-xs font-semibold text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#E5E5EA]">
              <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Line Item</th>
              <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Pricing Model</th>
              <th className="text-right py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Rate ({currency})</th>
              <th className="text-left py-2 px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wide">Events Mapped</th>
              <th className="py-2 px-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {localRules.map((rule) => (
              <tr key={rule.id} className="border-b border-[#F5F5F7] hover:bg-[#F5F5F7]/50 transition-colors">
                {editingId === rule.id ? (
                  <>
                    <td className="py-2 px-3">
                      <input
                        value={editState.lineItemName}
                        onChange={(e) => setEditState((s) => ({ ...s, lineItemName: e.target.value }))}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={editState.pricingModel}
                        onChange={(e) => setEditState((s) => ({ ...s, pricingModel: e.target.value }))}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand"
                      >
                        {PRICING_MODELS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editState.rate}
                        onChange={(e) => setEditState((s) => ({ ...s, rate: e.target.value }))}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="py-2 px-3 text-xs text-ink-muted">{rule.mappedEvents.length} mapped</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => saveEdit(rule.id)} disabled={isPending} className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-[10px] font-semibold text-ink-muted hover:text-ink">Cancel</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 px-3 font-semibold text-ink">{rule.lineItemName}</td>
                    <td className="py-2 px-3 font-mono text-xs text-ink-muted">{rule.pricingModel}</td>
                    <td className="py-2 px-3 text-right font-semibold text-emerald-700">${rule.rate.toFixed(2)}</td>
                    <td className="py-2 px-3 text-xs text-ink-muted">{rule.mappedEvents.length} mapped</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => startEdit(rule)} className="text-[10px] font-semibold text-brand hover:text-brand-hover">Edit</button>
                        <button onClick={() => deleteRule(rule.id, rule.lineItemName)} disabled={isPending} className="text-[10px] font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50">Delete</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}

            {/* Add new rule inline form */}
            {adding && (
              <tr className="border-b border-brand/20 bg-blue-50/30">
                <td className="py-2 px-3">
                  <input
                    value={addState.lineItemName}
                    onChange={(e) => setAddState((s) => ({ ...s, lineItemName: e.target.value }))}
                    placeholder="Line item name"
                    className="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </td>
                <td className="py-2 px-3">
                  <select
                    value={addState.pricingModel}
                    onChange={(e) => setAddState((s) => ({ ...s, pricingModel: e.target.value }))}
                    className="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    {PRICING_MODELS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={addState.rate}
                    onChange={(e) => setAddState((s) => ({ ...s, rate: e.target.value }))}
                    placeholder="0.00"
                    className="w-full text-xs border border-slate-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </td>
                <td className="py-2 px-3 text-xs text-ink-muted">—</td>
                <td className="py-2 px-3">
                  <div className="flex gap-1 justify-end">
                    <button onClick={addRule} disabled={isPending || !addState.lineItemName.trim()} className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50">Add</button>
                    <button onClick={() => { setAdding(false); setAddState(DEFAULT_EDIT); }} className="text-[10px] font-semibold text-ink-muted hover:text-ink">Cancel</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!adding && (
        <button
          onClick={() => { setAdding(true); setError(null); }}
          className="text-xs font-semibold text-brand hover:text-brand-hover transition-colors"
        >
          + Add Line Item
        </button>
      )}
    </div>
  );
}
