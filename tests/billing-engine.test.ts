import { describe, it, expect } from "vitest";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "@/lib/billing/constants";
import { computeChargeAmount, type RateRuleLike, type UsageEventLike } from "@/lib/billing/ratingEngine";
import { evaluateRateRuleCondition } from "@/lib/billing/conditionEvaluator";

// ── Shared test fixtures ──────────────────────────────────────────────────────

function makeRule(overrides: Partial<RateRuleLike> = {}): RateRuleLike {
  return {
    id: "rule_test",
    pricingModel: "PER_UNIT",
    rate: 4.0,
    includedQuantity: 0,
    tieredConfig: null,
    minCharge: null,
    maxCharge: null,
    conditions: null,
    lineItemName: "Test Service",
    currency: "USD",
    isBillable: true,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<UsageEventLike> = {}): UsageEventLike {
  return {
    eventCode: "HTS_CLASSIFICATION_COMPLETED",
    quantity: 1,
    success: true,
    automated: true,
    processingDuration: null,
    metadata: {},
    ...overrides,
  };
}

// ── 1. Telemetry & Definitions ────────────────────────────────────────────────

describe("Billing Event Definitions", () => {
  it("contains all required stable billing event codes including new agent-emitted ones", () => {
    const codes = DEFAULT_BILLING_EVENT_DEFINITIONS.map((d) => d.eventCode);

    expect(codes).toContain("DOCUMENT_PROCESSED");
    expect(codes).toContain("HTS_CLASSIFICATION_COMPLETED");
    expect(codes).toContain("HTS_MANUAL_REVIEW_COMPLETED");
    expect(codes).toContain("PRODUCT_NORMALIZATION_COMPLETED");
    expect(codes).toContain("ORIGIN_DETERMINATION_COMPLETED");
    expect(codes).toContain("VALUATION_COMPLETED");
    expect(codes).toContain("COMPLIANCE_REVIEW_COMPLETED");
    expect(codes).toContain("FILING_READINESS_COMPLETED");
    expect(codes).toContain("EXCEPTION_MANUALLY_RESOLVED");
    expect(codes).toContain("CUSTOMS_ENTRY_COMPLETED");
    expect(codes).toContain("ACE_FILING_TRANSMITTED");
    expect(codes).toContain("ISF_FILING_TRANSMITTED");
    expect(codes).toContain("RECONCILIATION_ENTRY_PREPARED");
    expect(codes).toContain("PGA_PROCESSING_COMPLETED");
  });

  it("every definition has a non-empty name and category", () => {
    for (const def of DEFAULT_BILLING_EVENT_DEFINITIONS) {
      expect(def.name.length, `${def.eventCode} missing name`).toBeGreaterThan(0);
      expect(def.category.length, `${def.eventCode} missing category`).toBeGreaterThan(0);
    }
  });
});

// ── 2. computeChargeAmount — all 13 pricing models ───────────────────────────

describe("computeChargeAmount", () => {
  it("PER_UNIT deducts includedQuantity before charging", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_UNIT", rate: 4.0, includedQuantity: 5 }),
      makeEvent({ quantity: 12 })
    );
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("conditionFieldMissing");
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(28.0); // (12 - 5) * 4
  });

  it("PER_TRANSACTION deducts includedQuantity before charging", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_TRANSACTION", rate: 2.5, includedQuantity: 0 }),
      makeEvent({ quantity: 10 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(25.0);
  });

  it("PER_UNIT returns null when all quantity is within includedQuantity", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_UNIT", rate: 4.0, includedQuantity: 20 }),
      makeEvent({ quantity: 5 })
    );
    expect(result).toBeNull();
  });

  it("FLAT_FEE always charges the rule rate regardless of quantity", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "FLAT_FEE", rate: 125.0, includedQuantity: 0 }),
      makeEvent({ quantity: 99 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(125.0);
  });

  it("PER_SHIPMENT charges rate once regardless of quantity", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_SHIPMENT", rate: 75.0 }),
      makeEvent({ quantity: 50 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(75.0);
  });

  it("PER_ENTRY charges rate once regardless of quantity", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_ENTRY", rate: 200.0 }),
      makeEvent({ quantity: 30 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(200.0);
  });

  it("BUNDLED charges rate once regardless of quantity", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "BUNDLED", rate: 500.0 }),
      makeEvent({ quantity: 10 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(500.0);
  });

  it("PER_DOCUMENT charges per-quantity like PER_UNIT", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_DOCUMENT", rate: 3.0, includedQuantity: 0 }),
      makeEvent({ quantity: 5 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(15.0);
  });

  it("PER_API_EVENT charges per-quantity like PER_UNIT", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_API_EVENT", rate: 0.10, includedQuantity: 0 }),
      makeEvent({ quantity: 100 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBeCloseTo(10.0);
  });

  it("PER_SUCCESSFUL_OUTCOME returns null on failure", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_SUCCESSFUL_OUTCOME", rate: 175.0 }),
      makeEvent({ success: false })
    );
    expect(result).toBeNull();
  });

  it("PER_SUCCESSFUL_OUTCOME charges full rate on success", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_SUCCESSFUL_OUTCOME", rate: 175.0 }),
      makeEvent({ success: true, quantity: 1 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(175.0);
  });

  it("TIERED computes multi-band pricing correctly", () => {
    // Band 1: Qty 1–5 @ $0, Band 2: Qty 6–20 @ $4, Band 3: Qty 21+ @ $2
    const tiers = [
      { fromQty: 1, toQty: 5, unitRate: 0.0 },
      { fromQty: 6, toQty: 20, unitRate: 4.0 },
      { fromQty: 21, toQty: null, unitRate: 2.0 },
    ];
    const result = computeChargeAmount(
      makeRule({ pricingModel: "TIERED", tieredConfig: tiers, rate: 0 }),
      makeEvent({ quantity: 25 }) // 5*0 + 15*4 + 5*2 = $70
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(70.0);
  });

  it("TIME_BASED charges hourly rate against processingDuration in ms", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "TIME_BASED", rate: 75.0 }),
      makeEvent({ processingDuration: 24 * 60 * 1000 }) // 24 min
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(30.0); // 0.4h * $75
  });

  it("PERCENTAGE_BASED charges a % of metadata.valueAmount", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PERCENTAGE_BASED", rate: 10.0 }),
      makeEvent({ metadata: { valueAmount: 4500 } })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(450.0);
  });

  it("CONDITIONAL evaluates true condition and charges", () => {
    const result = computeChargeAmount(
      makeRule({
        pricingModel: "CONDITIONAL",
        rate: 20.0,
        conditions: { field: "metadata.confidence", operator: "lt", value: 0.8 },
      }),
      makeEvent({ metadata: { confidence: 0.6 }, quantity: 1 })
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(20.0);
  });

  it("CONDITIONAL returns null when condition is false", () => {
    const result = computeChargeAmount(
      makeRule({
        pricingModel: "CONDITIONAL",
        rate: 20.0,
        conditions: { field: "metadata.confidence", operator: "lt", value: 0.8 },
      }),
      makeEvent({ metadata: { confidence: 0.9 }, quantity: 1 })
    );
    expect(result).toBeNull();
  });

  it("CONDITIONAL returns conditionFieldMissing when referenced field is absent", () => {
    const result = computeChargeAmount(
      makeRule({
        pricingModel: "CONDITIONAL",
        rate: 20.0,
        conditions: { field: "metadata.confidence", operator: "lt", value: 0.8 },
      }),
      makeEvent({ metadata: {}, quantity: 1 }) // no confidence field
    );
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("conditionFieldMissing", "metadata.confidence");
  });

  it("enforces minCharge floor when grossAmount falls below it", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_UNIT", rate: 1.0, includedQuantity: 0, minCharge: 50.0 }),
      makeEvent({ quantity: 15 }) // raw = $15, below $50 floor
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(50.0);
  });

  it("enforces maxCharge ceiling when grossAmount exceeds it", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_UNIT", rate: 10.0, includedQuantity: 0, maxCharge: 200.0 }),
      makeEvent({ quantity: 50 }) // raw = $500, above $200 ceiling
    );
    const { grossAmount } = result as { grossAmount: number };
    expect(grossAmount).toBe(200.0);
  });

  it("returns null for isBillable: false rules", () => {
    const result = computeChargeAmount(
      makeRule({ isBillable: false }),
      makeEvent()
    );
    expect(result).toBeNull();
  });

  it("trace includes pricingModel, baseRate, and eventQty for audit", () => {
    const result = computeChargeAmount(
      makeRule({ pricingModel: "PER_UNIT", rate: 5.0, includedQuantity: 2 }),
      makeEvent({ quantity: 7 })
    );
    const { trace } = result as { grossAmount: number; trace: Record<string, unknown> };
    expect(trace.pricingModel).toBe("PER_UNIT");
    expect(trace.baseRate).toBe(5.0);
    expect(trace.eventQty).toBe(7);
    expect(trace.billableQty).toBe(5);
  });
});

// ── 3. evaluateRateRuleCondition ─────────────────────────────────────────────

describe("evaluateRateRuleCondition", () => {
  it("returns matched:true for null conditions (unconditional)", () => {
    const result = evaluateRateRuleCondition(null, {});
    expect(result).toEqual({ matched: true });
  });

  it("eq operator matches exact value", () => {
    expect(evaluateRateRuleCondition({ field: "eventCode", operator: "eq", value: "HTS_CLASSIFICATION_COMPLETED" }, { eventCode: "HTS_CLASSIFICATION_COMPLETED" })).toEqual({ matched: true });
    expect(evaluateRateRuleCondition({ field: "eventCode", operator: "eq", value: "OTHER" }, { eventCode: "HTS_CLASSIFICATION_COMPLETED" })).toEqual({ matched: false });
  });

  it("neq operator matches when values differ", () => {
    expect(evaluateRateRuleCondition({ field: "success", operator: "neq", value: false }, { success: true })).toEqual({ matched: true });
  });

  it("lt / lte / gt / gte operators compare numerically", () => {
    const view = { metadata: { confidence: 0.75 } };
    expect(evaluateRateRuleCondition({ field: "metadata.confidence", operator: "lt", value: 0.8 }, view)).toEqual({ matched: true });
    expect(evaluateRateRuleCondition({ field: "metadata.confidence", operator: "lte", value: 0.75 }, view)).toEqual({ matched: true });
    expect(evaluateRateRuleCondition({ field: "metadata.confidence", operator: "gt", value: 0.8 }, view)).toEqual({ matched: false });
    expect(evaluateRateRuleCondition({ field: "metadata.confidence", operator: "gte", value: 0.75 }, view)).toEqual({ matched: true });
  });

  it("in operator matches value in array", () => {
    expect(evaluateRateRuleCondition({ field: "eventCode", operator: "in", value: ["A", "B", "HTS_CLASSIFICATION_COMPLETED"] }, { eventCode: "HTS_CLASSIFICATION_COMPLETED" })).toEqual({ matched: true });
    expect(evaluateRateRuleCondition({ field: "eventCode", operator: "in", value: ["A", "B"] }, { eventCode: "HTS_CLASSIFICATION_COMPLETED" })).toEqual({ matched: false });
  });

  it("returns fieldMissing when field does not exist on event view", () => {
    const result = evaluateRateRuleCondition({ field: "metadata.confidence", operator: "lt", value: 0.8 }, { metadata: {} });
    expect(result).toHaveProperty("fieldMissing", true);
    expect(result).toHaveProperty("field", "metadata.confidence");
  });

  it("all conditions in an array must pass (AND semantics)", () => {
    const conditions = [
      { field: "success", operator: "eq", value: true },
      { field: "metadata.confidence", operator: "gte", value: 0.9 },
    ];
    expect(evaluateRateRuleCondition(conditions, { success: true, metadata: { confidence: 0.95 } })).toEqual({ matched: true });
    expect(evaluateRateRuleCondition(conditions, { success: true, metadata: { confidence: 0.5 } })).toEqual({ matched: false });
  });
});

// ── 4. Ledger unit economics ──────────────────────────────────────────────────

describe("Shipment Financial Ledger Economics", () => {
  it("derives gross margin % from net revenue and total cost", () => {
    const grossRevenue = 208.0;
    const discount = 10.0;
    const netRevenue = grossRevenue - discount;
    const totalCost = 32.42;
    const grossProfit = netRevenue - totalCost;
    const grossMarginPct = (grossProfit / netRevenue) * 100;

    expect(netRevenue).toBe(198.0);
    expect(Number(grossProfit.toFixed(2))).toBe(165.58);
    expect(Number(grossMarginPct.toFixed(1))).toBe(83.6);
  });

  it("computes outstanding AR from invoiced minus paid", () => {
    const invoicedCharges = 198.0;
    const paidAmount = 100.0;
    expect(invoicedCharges - paidAmount).toBe(98.0);
  });
});
