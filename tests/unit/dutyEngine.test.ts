import { describe, it, expect } from "vitest";
import {
  calculateDutyStack,
  calculateMPFDecimal,
  getSection301Rate,
} from "../../src/lib/tariff/dutyEngine";
import { Decimal } from "../../src/lib/tariff/decimal";

describe("dutyEngine refactor & duty stack", () => {
  it("applies Section 301 25% rate for China origin under List 3", () => {
    const rate = getSection301Rate("CN", "List3", false);
    expect(rate.toNumber()).toBe(0.25);
  });

  it("returns 0% Section 301 rate when an exclusion is granted", () => {
    const rate = getSection301Rate("CN", "List3", true);
    expect(rate.toNumber()).toBe(0);
  });

  it("clamps MPF to statutory minimum ($31.67) for small customs values", () => {
    const mpfSmall = calculateMPFDecimal(new Decimal("1000")); // 1000 * 0.003464 = 3.46 -> clamped to 31.67
    expect(mpfSmall.toNumber()).toBe(31.67);
  });

  it("clamps MPF to statutory maximum ($614.35) for large customs values", () => {
    const mpfLarge = calculateMPFDecimal(new Decimal("500000")); // 500000 * 0.003464 = 1732 -> clamped to 614.35
    expect(mpfLarge.toNumber()).toBe(614.35);
  });

  it("computes full DutyStack with base, Section 301, AD/CVD, MPF, and HMF layers", () => {
    const stack = calculateDutyStack(
      {
        htsCode: "8481.80.5090",
        totalValue: 10000,
        countryOfOrigin: "CN",
      },
      {
        generalDutyRate: "5%",
        section301Applicable: true,
        section301Tranche: "List3",
        antidumpingRate: 15,
      }
    );

    expect(stack.base.toNumber()).toBe(500); // 5% of 10,000
    expect(stack.section301.toNumber()).toBe(2500); // 25% of 10,000
    expect(stack.antidumping.toNumber()).toBe(1500); // 15% of 10,000
    expect(stack.total.toNumber()).toBe(4500); // 500 + 2500 + 1500
    expect(stack.mpf.toNumber()).toBe(34.64); // 10000 * 0.003464
    expect(stack.hmf.toNumber()).toBe(12.5); // 10000 * 0.00125
    expect(stack.totalWithFees.toNumber()).toBe(4547.14);
  });
});
