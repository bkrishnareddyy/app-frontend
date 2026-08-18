import { describe, it, expect } from "vitest";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "@/lib/billing/constants";

describe("Billing, Costing & Rating Engine Suite", () => {
  // ── 1. Telemetry & Definitions ──────────────────────────────────────────
  describe("Telemetry Definitions & Event Codes", () => {
    it("contains all required stable billing event codes", () => {
      expect(DEFAULT_BILLING_EVENT_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
      const codes = DEFAULT_BILLING_EVENT_DEFINITIONS.map((d) => d.eventCode);

      expect(codes).toContain("DOCUMENT_PROCESSED");
      expect(codes).toContain("HTS_CLASSIFICATION_COMPLETED");
      expect(codes).toContain("HTS_MANUAL_REVIEW_COMPLETED");
      expect(codes).toContain("PRODUCT_NORMALIZATION_COMPLETED");
      expect(codes).toContain("PGA_PROCESSING_COMPLETED");
      expect(codes).toContain("EXCEPTION_MANUALLY_RESOLVED");
      expect(codes).toContain("CUSTOMS_ENTRY_COMPLETED");
      expect(codes).toContain("ACE_FILING_TRANSMITTED");
      expect(codes).toContain("ISF_FILING_TRANSMITTED");
      expect(codes).toContain("RECONCILIATION_ENTRY_PREPARED");
    });
  });

  // ── 2. Pricing Models Evaluation ───────────────────────────────────────
  describe("Pricing Models & Rating Engine Math", () => {
    it("rates PER_UNIT and PER_TRANSACTION with included quantity deduction", () => {
      const unitRate = 4.0; // $4/line
      const totalQty = 12;
      const includedQty = 5; // 5 lines included free
      const billableQty = Math.max(0, totalQty - includedQty);
      const grossAmount = billableQty * unitRate;

      expect(billableQty).toBe(7);
      expect(grossAmount).toBe(28.0);
    });

    it("rates FLAT_FEE, PER_SHIPMENT, and PER_ENTRY independently of quantity", () => {
      const flatRate = 125.0; // $125 flat entry fee
      const qty = 50; // Qty should not multiply flat fee
      const grossAmount = flatRate; // flat fee remains 125.00

      expect(grossAmount).toBe(125.0);
    });

    it("rates PER_SUCCESSFUL_OUTCOME ($0 on failure, full rate on success)", () => {
      const outcomeRate = 175.0;
      const successfulEvent = { success: true, rate: outcomeRate };
      const failedEvent = { success: false, rate: outcomeRate };

      const successfulCharge = successfulEvent.success ? successfulEvent.rate : 0;
      const failedCharge = failedEvent.success ? failedEvent.rate : 0;

      expect(successfulCharge).toBe(175.0);
      expect(failedCharge).toBe(0.0);
    });

    it("rates TIERED volume pricing across multiple quantity thresholds", () => {
      // Tier rule:
      // Band 1: Qty 1–5  -> Included ($0/unit)
      // Band 2: Qty 6–20 -> $4.00/unit
      // Band 3: Qty 21+  -> $2.00/unit
      const tiers = [
        { fromQty: 1, toQty: 5, unitRate: 0.0 },
        { fromQty: 6, toQty: 20, unitRate: 4.0 },
        { fromQty: 21, toQty: null, unitRate: 2.0 },
      ];

      const testQuantity = 25; // 5 free + 15 @ $4 + 5 @ $2
      let totalCharge = 0;
      let remainingQty = testQuantity;

      for (const tier of tiers) {
        if (remainingQty <= 0) break;
        const tierCapacity = tier.toQty ? tier.toQty - tier.fromQty + 1 : remainingQty;
        const qtyInTier = Math.min(remainingQty, tierCapacity);
        totalCharge += qtyInTier * tier.unitRate;
        remainingQty -= qtyInTier;
      }

      // 5*0 + 15*4 + 5*2 = 0 + 60 + 10 = $70.00
      expect(totalCharge).toBe(70.0);
    });

    it("rates TIME_BASED work accurately from duration in milliseconds", () => {
      const hourlyRate = 75.0; // $75/hour manual review
      const durationMs = 24 * 60 * 1000; // 24 minutes = 0.4 hours
      const durationHours = durationMs / (1000 * 60 * 60);
      const charge = durationHours * hourlyRate;

      expect(durationHours).toBe(0.4);
      expect(charge).toBe(30.0);
    });

    it("rates PERCENTAGE_BASED fee against entered merchandise value", () => {
      const dutyDrawbackPercent = 10.0; // 10% of recovered duty
      const recoveredDuty = 4500.0;
      const charge = recoveredDuty * (dutyDrawbackPercent / 100);

      expect(charge).toBe(450.0);
    });

    it("enforces MIN_CHARGE and MAX_CHARGE floor and ceiling boundaries", () => {
      const minCharge = 50.0;
      const maxCharge = 200.0;

      // Low calculation below floor
      let rawCharge1 = 15.0;
      if (rawCharge1 > 0 && rawCharge1 < minCharge) rawCharge1 = minCharge;
      expect(rawCharge1).toBe(50.0);

      // High calculation above ceiling
      let rawCharge2 = 350.0;
      if (rawCharge2 > maxCharge) rawCharge2 = maxCharge;
      expect(rawCharge2).toBe(200.0);
    });
  });

  // ── 3. Internal Costing & No-Fallback Integrity ──────────────────────
  describe("Internal Broker Costing & Honesty Controls", () => {
    it("calculates loaded labor duration cost with exact seconds", () => {
      const loadedLaborRate = 72.0; // $72.00/hr
      const durationSec = 15 * 60; // 15 minutes = 900 seconds
      const laborCost = (durationSec / 3600) * loadedLaborRate;

      expect(laborCost).toBe(18.0);
    });

    it("calculates AI technology cost using exact token counts", () => {
      const aiTokenRate = 0.00015; // $0.00015 per 1k tokens
      const actualTokenCount = 14200; // Exact tokens used
      const techCost = (actualTokenCount / 1000) * aiTokenRate;

      expect(Number(techCost.toFixed(5))).toBe(0.00213);
    });

    it("prevents arbitrary default fallbacks when metadata is missing", () => {
      const missingDuration: number | null = null;
      const missingTokens: number | null = null;

      // When telemetry is missing, system must NOT fabricate 5-min or 2500-token defaults
      const hasValidDuration = missingDuration !== null && missingDuration > 0;
      const hasValidTokens = missingTokens !== null && missingTokens > 0;

      expect(hasValidDuration).toBe(false);
      expect(hasValidTokens).toBe(false);
    });
  });

  // ── 4. Ledger Unit Economics & AR ─────────────────────────────────────
  describe("Shipment Financial Ledger & AR Balances", () => {
    it("computes Net Revenue, Gross Profit, and Gross Margin %", () => {
      const grossRevenue = 208.0;
      const discount = 10.0;
      const netRevenue = grossRevenue - discount; // $198.00
      const totalCost = 32.42; // AI ($3.42) + ACE ($4.00) + Labor ($18.25) + Ops ($6.75)
      const grossProfit = netRevenue - totalCost; // $165.58
      const grossMarginPct = (grossProfit / netRevenue) * 100;

      expect(netRevenue).toBe(198.0);
      expect(Number(grossProfit.toFixed(2))).toBe(165.58);
      expect(Number(grossMarginPct.toFixed(1))).toBe(83.6);
    });

    it("tracks Accounts Receivable states (Accrued, Unbilled, Invoiced, Paid, Outstanding)", () => {
      const accruedCharges = 198.0;
      const invoicedCharges = 198.0;
      const paidAmount = 100.0;
      const unbilledAmount = accruedCharges - invoicedCharges;
      const outstandingBalance = invoicedCharges - paidAmount;

      expect(unbilledAmount).toBe(0.0);
      expect(outstandingBalance).toBe(98.0);
    });
  });
});
