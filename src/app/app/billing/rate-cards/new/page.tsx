"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createRateCardAction } from "../../actions";

interface LineItemForm {
  lineItemName: string;
  serviceCode: string;
  pricingModel: string;
  unit: string;
  rate: number;
  minCharge: string;
  maxCharge: string;
  includedQuantity: number;
}

export default function CreateRateCardPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [isDefault, setIsDefault] = useState(false);
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [lineItems, setLineItems] = useState<LineItemForm[]>([
    {
      lineItemName: "Customs Entry Processing Fee",
      serviceCode: "ENTRY_SUMMARY",
      pricingModel: "PER_ENTRY",
      unit: "entry",
      rate: 125.0,
      minCharge: "",
      maxCharge: "",
      includedQuantity: 0,
    },
    {
      lineItemName: "Additional HTS Line Classification",
      serviceCode: "HTS_LINE",
      pricingModel: "PER_UNIT",
      unit: "line",
      rate: 4.0,
      minCharge: "",
      maxCharge: "",
      includedQuantity: 5,
    },
  ]);

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        lineItemName: "New Service Line Item",
        serviceCode: "CUSTOM_SERVICE",
        pricingModel: "PER_UNIT",
        unit: "unit",
        rate: 10.0,
        minCharge: "",
        maxCharge: "",
        includedQuantity: 0,
      },
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: keyof LineItemForm, value: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage("Please enter a Rate Card Name.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      await createRateCardAction({
        name,
        code,
        currency,
        isDefault,
        description,
        lineItems: lineItems.map((item) => ({
          lineItemName: item.lineItemName,
          serviceCode: item.serviceCode,
          pricingModel: item.pricingModel,
          unit: item.unit,
          rate: Number(item.rate),
          includedQuantity: Number(item.includedQuantity),
        })),
      });

      router.push("/app/billing/rate-cards");
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to save rate card.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Manual Rate Card Builder</h2>
          <p className="text-sm text-ink-muted">
            Create a custom customer rate card, add service line items, set volume thresholds, and activate version v1.
          </p>
        </div>
        <Link
          href="/app/billing/rate-cards"
          className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
        >
          ← Back to Rate Cards
        </Link>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
          {errorMessage}
        </div>
      )}

      {/* Rate Card Metadata Box */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <h3 className="text-base font-bold text-ink border-b border-[#E5E5EA] pb-3">
          Rate Card Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              Rate Card Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Manufacturing 2026 Rate Card"
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink text-sm focus:outline-none focus:border-brand"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              Internal Rate Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. RC-ACME-2026"
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink font-mono text-sm focus:outline-none focus:border-brand"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink uppercase tracking-wider">
              Currency
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink text-sm focus:outline-none focus:border-brand"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="CAD">CAD ($)</option>
            </select>
          </div>

          <div className="space-y-2 flex flex-col justify-end">
            <label className="flex items-center gap-2 cursor-pointer pt-2">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-slate-300 text-brand focus:ring-brand"
              />
              <span className="text-xs font-semibold text-ink">Set as Brokerage Default Rate Card</span>
            </label>
            <p className="text-[11px] text-ink-muted">
              Default rate cards apply to all clients without a dedicated override card.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-ink uppercase tracking-wider">
            Description & Terms
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contract notes, minimum monthly volumes, or commercial terms..."
            className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5EA] text-ink text-sm focus:outline-none focus:border-brand"
          />
        </div>
      </div>

      {/* Commercial Line Items Section */}
      <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
          <h3 className="text-base font-bold text-ink">Commercial Line Items ({lineItems.length})</h3>
          <button
            type="button"
            onClick={addLineItem}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-brand hover:bg-blue-100 transition-colors border border-blue-200"
          >
            + Add Line Item
          </button>
        </div>

        <div className="space-y-4">
          {lineItems.map((item, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink uppercase">Line Item #{idx + 1}</span>
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(idx)}
                    className="text-xs font-semibold text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-ink-muted">Customer Description</label>
                  <input
                    type="text"
                    value={item.lineItemName}
                    onChange={(e) => updateLineItem(idx, "lineItemName", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink focus:outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-ink-muted">Pricing Model</label>
                  <select
                    value={item.pricingModel}
                    onChange={(e) => updateLineItem(idx, "pricingModel", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink focus:outline-none focus:border-brand"
                  >
                    <option value="PER_ENTRY">Per Entry</option>
                    <option value="PER_UNIT">Per Unit / Line</option>
                    <option value="PER_TRANSACTION">Per Transaction</option>
                    <option value="FLAT_FEE">Flat Fee</option>
                    <option value="TIERED">Volume Tiered</option>
                    <option value="PER_SUCCESSFUL_OUTCOME">Per Successful Outcome</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-ink-muted">Rate ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.rate}
                    onChange={(e) => updateLineItem(idx, "rate", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink font-mono focus:outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-ink-muted">Included Qty</label>
                  <input
                    type="number"
                    value={item.includedQuantity}
                    onChange={(e) => updateLineItem(idx, "includedQuantity", e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink font-mono focus:outline-none focus:border-brand"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t border-[#E5E5EA] flex justify-end gap-3">
          <Link
            href="/app/billing/rate-cards"
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-ink transition-colors border border-slate-200"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm disabled:opacity-50"
          >
            {isSaving ? "Saving Rate Card..." : "Save & Activate Rate Card v1"}
          </button>
        </div>
      </div>
    </form>
  );
}
