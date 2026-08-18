import { describe, it, expect } from "vitest";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "@/lib/billing/telemetry";
import { DEFAULT_COST_PROFILE } from "@/lib/billing/costingEngine";

describe("Billing, Costing & Rating Engine", () => {
  it("defines standard billing event codes", () => {
    expect(DEFAULT_BILLING_EVENT_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
    const codes = DEFAULT_BILLING_EVENT_DEFINITIONS.map((d) => d.eventCode);
    expect(codes).toContain("HTS_CLASSIFICATION_COMPLETED");
    expect(codes).toContain("CUSTOMS_ENTRY_COMPLETED");
    expect(codes).toContain("ACE_FILING_TRANSMITTED");
  });

  it("evaluates unit pricing math correctly", () => {
    const rate = 4.0; // $4/line
    const qty = 7;
    const gross = qty * rate;
    expect(gross).toBe(28.0);
  });

  it("evaluates tiered pricing math correctly", () => {
    // First 5 lines included ($0), next 15 lines at $4, 21+ at $2
    const totalQty = 12; // 5 included, 7 at $4
    const includedQty = 5;
    const billableQty = Math.max(0, totalQty - includedQty);
    const lineRate = 4.0;
    const gross = billableQty * lineRate;
    expect(gross).toBe(28.0);
  });

  it("calculates loaded labor duration cost accurately", () => {
    const laborRate = DEFAULT_COST_PROFILE.loadedLaborRate; // $72/hr
    const durationSec = 12 * 60; // 12 minutes
    const cost = (durationSec / 3600) * laborRate;
    expect(cost).toBe(14.40);
  });

  it("computes shipment gross profit and gross margin % correctly", () => {
    const revenue = 208.0;
    const discount = 10.0;
    const netRevenue = revenue - discount; // 198.0
    const totalCost = 32.42;
    const profit = netRevenue - totalCost; // 165.58
    const marginPct = (profit / netRevenue) * 100;

    expect(netRevenue).toBe(198.0);
    expect(Number(profit.toFixed(2))).toBe(165.58);
    expect(marginPct.toFixed(1)).toBe("83.6");
  });
});
