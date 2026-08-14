"use client";

import { useState } from "react";
import { X, ShieldCheck, Award, DollarSign, AlertTriangle, FileText, CheckCircle2, XCircle } from "lucide-react";
import type { ShipmentLineItemRow as LineItem } from "./workspaceTypes";

interface LineItemDetailTabsModalProps {
  item: LineItem;
  shipmentId: string;
  onClose: () => void;
}

export function LineItemDetailTabsModal({ item, shipmentId, onClose }: LineItemDetailTabsModalProps) {
  const [activeTab, setActiveTab] = useState<"origin" | "qualification" | "valuation" | "adcvd">("origin");

  // Origin State
  const [originResult, setOriginResult] = useState<any>(null);
  const [originLoading, setOriginLoading] = useState(false);

  // Qualification State
  const [qualifyResult, setQualifyResult] = useState<any>(null);
  const [qualifyAgreement, setQualifyAgreement] = useState("USMCA");
  const [qualifyLoading, setQualifyLoading] = useState(false);
  const [usmcaDocumentText, setUsmcaDocumentText] = useState<string | null>(null);

  // Valuation State
  const [invoiceVal, setInvoiceVal] = useState<number>(Number(item.totalValue) || 1000);
  const [assistVal, setAssistVal] = useState<number>(0);
  const [freightVal, setFreightVal] = useState<number>(0);
  const [relatedParty, setRelatedParty] = useState(false);
  const [valuationResult, setValuationResult] = useState<any>(null);
  const [valLoading, setValLoading] = useState(false);

  // AD/CVD State
  const [adcvdResult, setAdcvdResult] = useState<any>(null);
  const [adcvdLoading, setAdcvdLoading] = useState(false);

  const runOriginDetermination = async () => {
    setOriginLoading(true);
    try {
      const res = await fetch("/api/advisory/origin-determination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentLineItemId: item.id,
          tradeAgreementCode: "USMCA",
          claimedCountry: item.countryOfOrigin,
        }),
      });
      const data = await res.json();
      setOriginResult(data.analysis);
    } catch (err) {
      console.error(err);
    } finally {
      setOriginLoading(false);
    }
  };

  const runQualify = async () => {
    setQualifyLoading(true);
    try {
      const res = await fetch("/api/v1/trade-agreements/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItemId: item.id,
          agreementCode: qualifyAgreement,
        }),
      });
      const data = await res.json();
      setQualifyResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setQualifyLoading(false);
    }
  };

  const generateUsmcaCertificate = () => {
    const certText = `
================================================================================
              USMCA CERTIFICATION OF ORIGIN (UNIFORM REGULATIONS)
================================================================================

1. CERTIFIER: Importer / Broker on record
2. EXPORTER:  Importer of Record
3. PRODUCER:  Manufacturer on record (${item.countryOfOrigin})
4. IMPORTER:  Importer of Record
5. DESCRIPTION OF GOOD: ${item.description}
6. HTS CLASSIFICATION:  ${item.htsCode}
7. ORIGIN CRITERION:    Criterion B (Regional Value Content / Tariff Shift)
8. BLANKET PERIOD:      2026-01-01 TO 2026-12-31

CERTIFICATION STATEMENT:
I certify that the goods described in this document qualify as originating and the
information contained in this document is true and accurate. I assume responsibility for
proving such representations and agree to maintain and present upon request documents
necessary to support this certification.

AUTHORIZATION SIGNATURE: [Digitally Verified via Qubere Agentic Platform]
DATE: ${new Date().toISOString().split("T")[0]}
================================================================================
`;
    setUsmcaDocumentText(certText);
  };

  const runValuation = async () => {
    setValLoading(true);
    try {
      const res = await fetch(`/api/products/${item.productId || "unknown"}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentLineItemId: item.id,
          invoiceValue: invoiceVal,
          assists: assistVal > 0 ? [{ category: "tools", unitCost: assistVal, quantity: 1 }] : [],
          freightToUSPort: freightVal,
          relatedParty,
        }),
      });
      const data = await res.json();
      setValuationResult(data.valuation);
    } catch (err) {
      console.error(err);
    } finally {
      setValLoading(false);
    }
  };

  const runAdcvdScreening = async () => {
    setAdcvdLoading(true);
    try {
      const res = await fetch(`/api/products/${item.productId || "unknown"}/adcvd-screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId,
          shipmentLineItemId: item.id,
          htsCode: item.htsCode,
          countryOfOrigin: item.countryOfOrigin,
          productDescription: item.description,
        }),
      });
      const data = await res.json();
      setAdcvdResult(data.screening);
    } catch (err) {
      console.error(err);
    } finally {
      setAdcvdLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl max-w-3xl w-full p-6 shadow-2xl overflow-hidden text-ink">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-brand font-semibold">Line {item.lineNumber}</span>
              <h3 className="text-base font-bold">{item.description}</h3>
            </div>
            <p className="text-xs text-ink-muted mt-1">
              HTS: <span className="font-mono">{item.htsCode}</span> · Origin: <span>{item.countryOfOrigin}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs navigation */}
        <div className="flex items-center gap-2 border-b border-border my-4">
          <button
            onClick={() => setActiveTab("origin")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "origin" ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <ShieldCheck className="w-4 h-4" /> Origin Determination
          </button>
          <button
            onClick={() => setActiveTab("qualification")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "qualification" ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <Award className="w-4 h-4" /> Trade Qualification
          </button>
          <button
            onClick={() => setActiveTab("valuation")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "valuation" ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <DollarSign className="w-4 h-4" /> Customs Valuation
          </button>
          <button
            onClick={() => setActiveTab("adcvd")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "adcvd" ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <AlertTriangle className="w-4 h-4" /> AD/CVD Scope
          </button>
        </div>

        {/* Tab contents */}
        <div className="min-h-[260px] max-h-[420px] overflow-y-auto pr-1">
          {/* TAB 1: ORIGIN */}
          {activeTab === "origin" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-muted">Run rules-of-origin substantial transformation & RVC analysis.</p>
                <button
                  onClick={runOriginDetermination}
                  disabled={originLoading}
                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:bg-brand/90 disabled:opacity-50"
                >
                  {originLoading ? "Evaluating..." : "Run Determination"}
                </button>
              </div>

              {originResult && (
                <div className="bg-surface-muted/50 p-4 rounded-xl space-y-3 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Determined Country:</span>
                    <span className="font-semibold text-xs px-2 py-0.5 rounded bg-brand/10 text-brand">
                      {originResult.determinedCountry}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Legal Basis:</span>
                    <span className="text-xs font-mono">{originResult.basis}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Confidence Score:</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${originResult.confidence < 80 ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`}>
                      {originResult.confidence}%
                    </span>
                  </div>
                  {originResult.confidence < 80 && (
                    <div className="flex items-start gap-2 bg-amber-500/10 text-amber-600 p-2.5 rounded-lg text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Confidence is below 80%. A compliance exception item was automatically logged for specialist review.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TRADE QUALIFICATION */}
          {activeTab === "qualification" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <select
                  value={qualifyAgreement}
                  onChange={(e) => setQualifyAgreement(e.target.value)}
                  className="bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none"
                >
                  <option value="USMCA">USMCA</option>
                  <option value="CAFTA-DR">CAFTA-DR</option>
                  <option value="KORUS">KORUS</option>
                  <option value="GSP">GSP</option>
                </select>
                <button
                  onClick={runQualify}
                  disabled={qualifyLoading}
                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:bg-brand/90 disabled:opacity-50"
                >
                  {qualifyLoading ? "Evaluating..." : "Qualify Line Item"}
                </button>
              </div>

              <div className="text-[11px] text-ink-muted bg-surface-muted/30 p-2.5 rounded-lg border border-border/60">
                <span className="font-semibold text-brand">Coverage note:</span> Rule evaluation uses key HTS chapter Product-Specific Rules (USMCA Annex 4-B chapters 27-30, 39, 64, 73, 84-85, 87-88, 90, 94; CAFTA-DR 61-62, 64, 84; KORUS 84-85, 87; GSP 35% RVC). Unmapped chapters use generic agreement thresholds.
              </div>

              {qualifyResult && (
                <div className="bg-surface-muted/50 p-4 rounded-xl space-y-3 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Agreement:</span>
                    <span className="text-xs font-semibold">{qualifyResult.agreementCode}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Status:</span>
                    {qualifyResult.qualified ? (
                      <span className="flex items-center gap-1 text-emerald-500 text-xs font-bold">
                        <CheckCircle2 className="w-4 h-4" /> Qualified
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-500 text-xs font-bold">
                        <XCircle className="w-4 h-4" /> Not Qualified / Missing Evidence
                      </span>
                    )}
                  </div>

                  {qualifyResult.gaps?.length > 0 && (
                    <div className="space-y-2 mt-2">
                      <span className="text-xs font-bold text-ink-muted">Evidence Gaps:</span>
                      {qualifyResult.gaps.map((g: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 bg-red-500/10 text-red-500 p-2 rounded text-xs">
                          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{g.missing}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {qualifyResult.qualified && qualifyAgreement === "USMCA" && (
                    <div className="pt-2">
                      <button
                        onClick={generateUsmcaCertificate}
                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-500"
                      >
                        <FileText className="w-4 h-4" /> Generate USMCA Certification of Origin
                      </button>
                    </div>
                  )}
                </div>
              )}

              {usmcaDocumentText && (
                <div className="mt-3">
                  <span className="text-xs font-bold mb-1 block">Generated USMCA Certificate Preview:</span>
                  <pre className="bg-black/90 text-emerald-400 p-3 rounded-xl font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                    {usmcaDocumentText}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: VALUATION */}
          {activeTab === "valuation" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-ink-muted mb-1 font-semibold">Invoice Price (USD)</label>
                  <input
                    type="number"
                    value={invoiceVal}
                    onChange={(e) => setInvoiceVal(Number(e.target.value))}
                    className="w-full bg-surface border border-border rounded-lg p-2 text-ink"
                  />
                </div>
                <div>
                  <label className="block text-ink-muted mb-1 font-semibold">Assists Total (19 CFR 152.103)</label>
                  <input
                    type="number"
                    value={assistVal}
                    onChange={(e) => setAssistVal(Number(e.target.value))}
                    className="w-full bg-surface border border-border rounded-lg p-2 text-ink"
                  />
                </div>
                <div>
                  <label className="block text-ink-muted mb-1 font-semibold">Freight/Insurance Deduction</label>
                  <input
                    type="number"
                    value={freightVal}
                    onChange={(e) => setFreightVal(Number(e.target.value))}
                    className="w-full bg-surface border border-border rounded-lg p-2 text-ink"
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="relParty"
                    checked={relatedParty}
                    onChange={(e) => setRelatedParty(e.target.checked)}
                    className="rounded border-border"
                  />
                  <label htmlFor="relParty" className="text-xs font-semibold cursor-pointer">
                    Related-Party Transaction
                  </label>
                </div>
              </div>

              <button
                onClick={runValuation}
                disabled={valLoading}
                className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:bg-brand/90 disabled:opacity-50"
              >
                {valLoading ? "Calculating..." : "Calculate Customs Value"}
              </button>

              {valuationResult && (
                <div className="bg-surface-muted/50 p-4 rounded-xl space-y-2 border border-border text-xs">
                  <div className="flex justify-between border-b border-border pb-1">
                    <span>Transaction Price:</span>
                    <span className="font-mono font-semibold">${valuationResult.breakdown.invoice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-b border-border pb-1 text-emerald-500">
                    <span>+ Additions (Assists/Royalties):</span>
                    <span className="font-mono font-semibold">+${valuationResult.additionsTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-b border-border pb-1 text-amber-500">
                    <span>- Deductions (Freight/Insurance):</span>
                    <span className="font-mono font-semibold">-${valuationResult.deductionsTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between pt-1 font-bold text-sm">
                    <span>Final Declared Customs Value:</span>
                    <span className="font-mono text-brand">${valuationResult.customsValue.toLocaleString()}</span>
                  </div>
                  {valuationResult.relatedPartyFlagged && (
                    <div className="mt-2 bg-amber-500/10 text-amber-600 p-2 rounded text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Flagged: Related-party transaction requires broker arm&apos;s-length documentation. Exception created.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: AD/CVD */}
          {activeTab === "adcvd" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-muted">Screen HTS code and country against active USITC/Commerce AD/CVD orders.</p>
                <button
                  onClick={runAdcvdScreening}
                  disabled={adcvdLoading}
                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:bg-brand/90 disabled:opacity-50"
                >
                  {adcvdLoading ? "Screening..." : "Screen AD/CVD Scope"}
                </button>
              </div>

              {adcvdResult && (
                <div className="space-y-3">
                  {adcvdResult.orders.length === 0 ? (
                    <div className="bg-emerald-500/10 text-emerald-500 p-4 rounded-xl text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>No active AD/CVD orders match this line item HTS code and origin.</span>
                    </div>
                  ) : (
                    adcvdResult.orders.map((o: any, idx: number) => (
                      <div key={idx} className="bg-surface-muted/50 p-4 rounded-xl border border-border space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-brand">{o.caseNumber}</span>
                          <span className={`px-2 py-0.5 rounded font-bold ${o.inScope === "YES" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"}`}>
                            {o.inScope}
                          </span>
                        </div>
                        <p className="font-semibold">{o.title}</p>
                        <p className="text-ink-muted text-[11px]">{o.reasoning}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
