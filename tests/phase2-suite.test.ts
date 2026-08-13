import { describe, it, expect } from "vitest";
import {
  calculateMPF,
  calculateHMF,
  calculateLineItemDuty,
  computeFilingTariff,
  MPF_MINIMUM,
  MPF_MAXIMUM,
  MPF_RATE,
  HMF_RATE,
} from "../src/lib/tariff/dutyEngine";

// This suite previously exercised a mock class defined in this same file, so it
// asserted nothing about the application. It now drives the real tariff engine.

describe("Tariff engine: statutory fee bounds", () => {
  it("applies the MPF floor to small entries", () => {
    // 0.3464% of $1,000 is $3.46, below the statutory minimum.
    expect(calculateMPF(1000)).toBe(MPF_MINIMUM.toNumber());
  });

  it("applies the MPF ceiling to large entries", () => {
    // Unclamped this would be $3,464 on a $1M entry.
    expect(calculateMPF(1_000_000)).toBe(MPF_MAXIMUM.toNumber());
  });

  it("charges the rate between the floor and the ceiling", () => {
    const customsValue = 50_000;
    const expected = Math.round(customsValue * MPF_RATE.toNumber() * 100) / 100;
    expect(expected).toBeGreaterThan(MPF_MINIMUM.toNumber());
    expect(expected).toBeLessThan(MPF_MAXIMUM.toNumber());
    expect(calculateMPF(customsValue)).toBe(expected);
  });

  it("charges no MPF on a zero-value entry rather than the floor", () => {
    expect(calculateMPF(0)).toBe(0);
  });

  it("charges HMF only on ocean shipments", () => {
    expect(calculateHMF(100_000, true)).toBe(Math.round(100_000 * HMF_RATE.toNumber() * 100) / 100);
    expect(calculateHMF(100_000, false)).toBe(0);
  });
});

describe("Tariff engine: line item duty", () => {
  it("uses the HTS general rate when one is published", () => {
    const result = calculateLineItemDuty(
      { quantity: 50, unitPrice: 100 } as never,
      { generalDutyRate: "2.8%" } as never
    );
    expect(result.customsValue).toBe(5000);
    expect(result.baseDutyRate).toBeCloseTo(0.028);
    expect(result.baseDutyAmount).toBe(140);
  });

  it("keeps a genuine duty-free rate at zero rather than falling back to a default", () => {
    const result = calculateLineItemDuty(
      { quantity: 10, unitPrice: 250 } as never,
      { generalDutyRate: "0%" } as never
    );
    expect(result.baseDutyRate).toBe(0);
    expect(result.baseDutyAmount).toBe(0);
  });

  it("adds Section 301 and 232 duties on top of the base rate", () => {
    const result = calculateLineItemDuty(
      { quantity: 1, unitPrice: 10_000 } as never,
      {
        generalDutyRate: "2.8%",
        section301Applicable: true,
        section301AdditionalRate: 25,
      } as never
    );
    expect(result.section301Amount).toBe(2500);
    expect(result.totalDutyAmount).toBe(2780);
  });

  it("reports an unrated line rather than inventing a default rate", () => {
    const result = calculateLineItemDuty({ quantity: 4, unitPrice: 500 } as never, null);
    expect(result.customsValue).toBe(2000);
    expect(result.baseDutyRate).toBeNull();
    expect(result.baseDutyAmount).toBe(0);
  });
});

describe("Tariff engine: entry level aggregation", () => {
  it("charges MPF once per entry, not once per line", () => {
    const lines = Array.from({ length: 5 }, () => ({ quantity: 1, unitPrice: 1000 }));
    const result = computeFilingTariff(lines as never);

    expect(result.totalCustomsValue).toBe(5000);
    // Five lines at $1,000 each would each hit the floor if fees were per line.
    expect(result.totalFees).toBeLessThan(MPF_MINIMUM.toNumber() * 5);

    const mpfLine = result.dutyBreakdown.find((f) => f.feeName.includes("MPF"));
    expect(mpfLine?.amount).toBe(calculateMPF(5000));
  });

  it("does not exceed the MPF ceiling across many lines", () => {
    const lines = Array.from({ length: 20 }, () => ({ quantity: 1, unitPrice: 100_000 }));
    const result = computeFilingTariff(lines as never);

    const mpfLine = result.dutyBreakdown.find((f) => f.feeName.includes("MPF"));
    expect(mpfLine?.amount).toBe(MPF_MAXIMUM.toNumber());
  });

  it("counts lines with no resolvable rate so a total is never mistaken for complete", () => {
    const lines = [
      { quantity: 1, unitPrice: 1000, htsCode: "8481.80.5090" },
      { quantity: 1, unitPrice: 1000, htsCode: "9999.99.9999" },
    ];
    const result = computeFilingTariff(lines as never, {
      "8481.80.5090": { generalDutyRate: "2.8%" } as never,
    });

    expect(result.unratedLineCount).toBe(1);
    expect(result.totalDuty).toBe(28);
  });
});
