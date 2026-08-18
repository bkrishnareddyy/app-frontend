"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "@/lib/billing/constants";
import { createImportedRateCardAction, parseRateCardUploadAction } from "./actions";

type ParsedUpload = Awaited<ReturnType<typeof parseRateCardUploadAction>>;

const PRICING_MODELS = [
  "PER_TRANSACTION",
  "PER_UNIT",
  "PER_SHIPMENT",
  "PER_ENTRY",
  "PER_DOCUMENT",
  "PER_API_EVENT",
  "PER_SUCCESSFUL_OUTCOME",
  "FLAT_FEE",
  "TIERED",
  "TIME_BASED",
  "PERCENTAGE_BASED",
] as const;

function detectHeader(headers: string[], candidates: string[]) {
  return headers.find((header) => candidates.some((candidate) => header.toLowerCase().includes(candidate))) ?? headers[0] ?? "";
}

function parseMoney(value: string) {
  const normalized = value.replace(/[$,\s]/g, "").replace(/\((.*)\)/, "-$1");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function inferEvent(description: string) {
  const text = description.toLowerCase();
  if (text.includes("class") || text.includes("hts")) return "HTS_CLASSIFICATION_COMPLETED";
  if (text.includes("manual") || text.includes("review")) return "HTS_MANUAL_REVIEW_COMPLETED";
  if (text.includes("document")) return "DOCUMENT_PROCESSED";
  if (text.includes("pga")) return "PGA_PROCESSING_COMPLETED";
  if (text.includes("reconcil")) return "RECONCILIATION_COMPLETED";
  if (text.includes("filing") || text.includes("entry")) return "CUSTOMS_ENTRY_COMPLETED";
  return DEFAULT_BILLING_EVENT_DEFINITIONS[0]?.eventCode ?? "CUSTOMS_ENTRY_COMPLETED";
}

export default function ImportRateCardPage() {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [rateColumn, setRateColumn] = useState("");
  const [unitColumn, setUnitColumn] = useState("");
  const [serviceCodeColumn, setServiceCodeColumn] = useState("");
  const [eventByRow, setEventByRow] = useState<Record<number, string>>({});
  const [pricingByRow, setPricingByRow] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await parseRateCardUploadAction(formData);
      const descHeader = detectHeader(result.headers, ["description", "service", "item", "charge", "fee"]);
      const rateHeader = detectHeader(result.headers, ["rate", "price", "amount", "fee"]);
      const unitHeader = result.headers.find((header) => /unit|basis|uom/i.test(header)) ?? "";
      const codeHeader = result.headers.find((header) => /code|sku|service id/i.test(header)) ?? "";

      setParsed(result);
      setName(file.name.replace(/\.csv$/i, ""));
      setDescriptionColumn(descHeader);
      setRateColumn(rateHeader);
      setUnitColumn(unitHeader);
      setServiceCodeColumn(codeHeader);

      const events: Record<number, string> = {};
      const pricing: Record<number, string> = {};
      result.rows.forEach((row, index) => {
        events[index] = inferEvent(String(row[descHeader] ?? ""));
        pricing[index] = String(row[unitHeader] ?? "").toLowerCase().includes("entry") ? "PER_ENTRY" : "PER_UNIT";
      });
      setEventByRow(events);
      setPricingByRow(pricing);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : "Unable to parse the uploaded rate card.");
    } finally {
      setLoading(false);
    }
  };

  const mappedRows = useMemo(() => {
    if (!parsed || !descriptionColumn || !rateColumn) return [];
    return parsed.rows.map((row, index) => ({
      index,
      description: String(row[descriptionColumn] ?? "").trim(),
      rateText: String(row[rateColumn] ?? "").trim(),
      rate: parseMoney(String(row[rateColumn] ?? "")),
      unit: unitColumn ? String(row[unitColumn] ?? "unit").trim() || "unit" : "unit",
      serviceCode: serviceCodeColumn ? String(row[serviceCodeColumn] ?? "").trim() : "",
    })).filter((row) => row.description || row.rateText);
  }, [parsed, descriptionColumn, rateColumn, unitColumn, serviceCodeColumn]);

  const invalidRateCount = mappedRows.filter((row) => !Number.isFinite(row.rate) || row.rate < 0).length;

  const createRateCard = async () => {
    if (!parsed) return;
    if (!name.trim()) return setError("Enter a rate-card name.");
    if (!descriptionColumn || !rateColumn) return setError("Map the description and rate columns.");
    if (!mappedRows.length) return setError("No billable rows were found after column mapping.");
    if (invalidRateCount) return setError(`${invalidRateCount} row(s) contain invalid rates. Correct the source CSV or column mapping.`);

    setSaving(true);
    setError(null);
    try {
      const result = await createImportedRateCardAction({
        name: name.trim(),
        currency,
        description: `Imported from ${parsed.fileName}`,
        lines: mappedRows.map((row) => ({
          lineItemName: row.description,
          serviceCode: row.serviceCode || eventByRow[row.index] || "IMPORTED_SERVICE",
          pricingModel: pricingByRow[row.index] || "PER_UNIT",
          unit: row.unit,
          rate: row.rate,
          includedQuantity: 0,
          eventCode: eventByRow[row.index] || inferEvent(row.description),
        })),
      });
      router.push(`/app/billing/rate-cards/${result.rateCardId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the imported rate card.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Import Customer Rate Card</h2>
          <p className="text-sm text-ink-muted">Parse a customer CSV, map its columns, map each service to a Qubere billing event, then create a reviewable draft rate card.</p>
        </div>
        <Link href="/app/billing/rate-cards" className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors">← Back to Rate Cards</Link>
      </div>

      {error && <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">{error}</div>}

      {!parsed && (
        <div className="p-12 rounded-2xl bg-white border-2 border-dashed border-[#E5E5EA] hover:border-brand/50 transition-colors text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-brand flex items-center justify-center mx-auto text-xl font-bold border border-blue-100">↑</div>
          <div>
            <h3 className="text-base font-bold text-ink">Select Customer Rate Card</h3>
            <p className="text-xs text-ink-muted mt-1">CSV (.csv) and Excel (.xlsx, .xls) files are supported. Only the first sheet of a spreadsheet is imported. Maximum 5 MB, 250 preview rows.</p>
          </div>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" id="rate-card-upload" disabled={loading} />
          <label htmlFor="rate-card-upload" className="inline-block px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white cursor-pointer transition-colors shadow-sm">
            {loading ? "Parsing..." : "Browse File"}
          </label>
        </div>
      )}

      {parsed && (
        <>
          <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink">1. Rate Card & Column Mapping</h3>
                <p className="text-xs text-ink-muted mt-1">{parsed.fileName} • {parsed.rowCount} source rows{parsed.truncated ? ` • preview limited to ${parsed.rows.length}` : ""}</p>
              </div>
              <button type="button" onClick={() => setParsed(null)} className="text-xs font-semibold text-ink-muted hover:text-ink">Choose Different File</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-[11px] font-semibold text-ink-muted">Rate Card Name</label><input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E5E5EA] text-sm" /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Currency</label><select value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E5E5EA] text-sm"><option>USD</option><option>CAD</option><option>EUR</option><option>GBP</option></select></div>
              <ColumnSelect label="Customer Description *" headers={parsed.headers} value={descriptionColumn} onChange={setDescriptionColumn} />
              <ColumnSelect label="Rate / Amount *" headers={parsed.headers} value={rateColumn} onChange={setRateColumn} />
              <ColumnSelect label="Unit / Billing Basis" headers={parsed.headers} value={unitColumn} onChange={setUnitColumn} optional />
              <ColumnSelect label="Customer Service Code" headers={parsed.headers} value={serviceCodeColumn} onChange={setServiceCodeColumn} optional />
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm space-y-5">
            <div>
              <h3 className="text-base font-bold text-ink">2. Service & Capability Mapping</h3>
              <p className="text-xs text-ink-muted mt-1">Review parsed rates and map each customer line item to the stable Qubere event that earns the charge.</p>
            </div>

            <div className="space-y-3 max-h-[650px] overflow-y-auto pr-1">
              {mappedRows.map((row) => (
                <div key={row.index} className="grid grid-cols-1 lg:grid-cols-[1.4fr_.7fr_1fr_1fr] gap-3 p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] items-end">
                  <div><div className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Customer Line</div><div className="text-sm font-bold text-ink mt-1">{row.description || "Missing description"}</div><div className={`text-xs font-mono mt-1 ${Number.isFinite(row.rate) && row.rate >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{row.rateText || "Missing rate"} {row.unit ? `/ ${row.unit}` : ""}</div></div>
                  <div><label className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Pricing</label><select value={pricingByRow[row.index] || "PER_UNIT"} onChange={(e) => setPricingByRow({ ...pricingByRow, [row.index]: e.target.value })} className="mt-1 w-full px-2 py-2 rounded-lg border border-[#E5E5EA] bg-white text-xs">{PRICING_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}</select></div>
                  <div className="lg:col-span-2"><label className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Qubere Billing Event</label><select value={eventByRow[row.index] || inferEvent(row.description)} onChange={(e) => setEventByRow({ ...eventByRow, [row.index]: e.target.value })} className="mt-1 w-full px-2 py-2 rounded-lg border border-[#E5E5EA] bg-white text-xs font-mono">{DEFAULT_BILLING_EVENT_DEFINITIONS.map((def) => <option key={def.eventCode} value={def.eventCode}>{def.name} — {def.eventCode}</option>)}</select></div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[#E5E5EA]">
              <div className="text-xs text-ink-muted">{mappedRows.length} mapped rows • {invalidRateCount ? `${invalidRateCount} invalid rates` : "rates validated"}</div>
              <button type="button" onClick={createRateCard} disabled={saving || mappedRows.length === 0 || invalidRateCount > 0} className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm disabled:opacity-50">{saving ? "Creating Draft..." : "Create Draft Rate Card →"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ColumnSelect({ label, headers, value, onChange, optional = false }: { label: string; headers: string[]; value: string; onChange: (value: string) => void; optional?: boolean }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-ink-muted">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E5E5EA] text-sm bg-white">
        {optional && <option value="">Not provided</option>}
        {!optional && !value && <option value="">Select column</option>}
        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
      </select>
    </div>
  );
}
