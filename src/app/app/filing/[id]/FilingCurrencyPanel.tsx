"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

interface CurrencyContext {
  commercialCurrency: string;
  customsCurrency: string;
  exchangeRate: number;
  exchangeRateSource: string;
  exchangeRateEffectiveDate: string;
}

export function FilingCurrencyPanel({ filingId }: { filingId: string }) {
  const [context, setContext] = useState<CurrencyContext | null>(null);
  const [country, setCountry] = useState("US");
  const [locked, setLocked] = useState(false);
  const [detectedCurrencies, setDetectedCurrencies] = useState<string[]>([]);
  const [currencyConflict, setCurrencyConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/filing/${filingId}/currency`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to load filing currency");
        if (!cancelled) {
          setContext(payload.currencyContext);
          setCountry(payload.country || "US");
          setLocked(Boolean(payload.locked));
          setDetectedCurrencies(Array.isArray(payload.detectedCurrencies) ? payload.detectedCurrencies : []);
          setCurrencyConflict(Boolean(payload.currencyConflict));
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Failed to load filing currency");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filingId]);

  const crossCurrency = useMemo(
    () => Boolean(context && context.commercialCurrency !== context.customsCurrency),
    [context]
  );

  async function save() {
    if (!context || locked) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/filing/${filingId}/currency`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commercialCurrency: context.commercialCurrency,
          customsCurrency: context.customsCurrency,
          exchangeRate: crossCurrency ? Number(context.exchangeRate) : 1,
          exchangeRateSource: crossCurrency ? context.exchangeRateSource : "IDENTITY",
          exchangeRateEffectiveDate: crossCurrency
            ? new Date(context.exchangeRateEffectiveDate).toISOString()
            : new Date().toISOString(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save filing currency");
      setContext(payload.currencyContext);
      setCurrencyConflict(false);
      setMessage("Currency settings saved. They will be frozen into the filing snapshot at submission.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save filing currency");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="rounded-2xl border border-border bg-white p-5 text-xs text-ink-muted">Loading filing currency…</div>;
  if (!context) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-xs text-red-700">{message || "Currency configuration unavailable."}</div>;

  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-ink">Filing Currency & Customs Valuation</h2>
          <p className="text-xs text-ink-muted mt-1">Preserve the commercial invoice currency separately from the {country} customs valuation currency.</p>
        </div>
        {locked && <span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">Locked after submission</span>}
      </div>

      {currencyConflict && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold">Document currency conflict requires review.</p>
          <p className="mt-1">Qubere found multiple invoice currencies ({detectedCurrencies.join(", ")}). Select the commercial currency that applies to this filing and save it before submission.</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="commercialCurrency">Commercial / Invoice Currency</Label>
          <Input id="commercialCurrency" value={context.commercialCurrency} maxLength={3} disabled={locked} onChange={(event) => setContext({ ...context, commercialCurrency: event.target.value.toUpperCase() })} placeholder="EUR" />
          {detectedCurrencies.length === 1 && <p className="text-[10px] text-ink-muted">Detected from shipment documents: {detectedCurrencies[0]}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customsCurrency">Customs Valuation Currency</Label>
          <Input id="customsCurrency" value={context.customsCurrency} maxLength={3} disabled={locked} onChange={(event) => setContext({ ...context, customsCurrency: event.target.value.toUpperCase() })} placeholder="USD" />
        </div>
      </div>

      {crossCurrency ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="exchangeRate">Exchange Rate</Label>
            <Input id="exchangeRate" type="number" min="0" step="0.000001" value={context.exchangeRate || ""} disabled={locked} onChange={(event) => setContext({ ...context, exchangeRate: Number(event.target.value) })} />
            <p className="text-[10px] text-ink-muted">{context.customsCurrency} per 1 {context.commercialCurrency}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exchangeRateSource">Rate Source</Label>
            <Input id="exchangeRateSource" value={context.exchangeRateSource === "IDENTITY" ? "" : context.exchangeRateSource} disabled={locked} onChange={(event) => setContext({ ...context, exchangeRateSource: event.target.value })} placeholder="CBP published rate" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exchangeRateEffectiveDate">Effective Date</Label>
            <Input id="exchangeRateEffectiveDate" type="date" value={context.exchangeRateEffectiveDate.slice(0, 10)} disabled={locked} onChange={(event) => setContext({ ...context, exchangeRateEffectiveDate: `${event.target.value}T00:00:00.000Z` })} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">No FX conversion is required because the invoice and customs valuation currencies match.</div>
      )}

      <p className="text-[11px] text-ink-muted">Qubere does not silently substitute a market FX quote. For cross-currency filings, enter the customs-approved rate, its source, and effective date.</p>
      {message && <p className={`text-xs ${message.startsWith("Currency settings saved") ? "text-emerald-700" : "text-red-700"}`}>{message}</p>}
      {!locked && <div className="flex justify-end"><Button type="button" size="sm" loading={saving} onClick={save}>Save Currency Settings</Button></div>}
    </section>
  );
}
