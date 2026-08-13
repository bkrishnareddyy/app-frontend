import { describe, it, expect } from "vitest";
import { calculateCustomsValuation } from "../../src/lib/valuation/valuationEngine";

describe("valuationEngine", () => {
  it("calculates customs value with assists (invoice + assists)", () => {
    const res = calculateCustomsValuation({
      invoiceValue: 10000,
      currency: "USD",
      assists: [
        { category: "tools", description: "Custom Injection Mold", unitCost: 500, quantity: 2 },
        { category: "materials", description: "Free Raw Polymer", unitCost: 200, quantity: 5 },
      ],
      freightToUSPort: 0,
      insuranceToUSPort: 0,
    });

    expect(res.assistsTotal).toBe(2000); // (500*2) + (200*5) = 2000
    expect(res.transactionValue).toBe(12000); // 10000 + 2000
    expect(res.customsValue).toBe(12000);
  });

  it("applies deductions for freight to US port and discounts on FOB invoice", () => {
    const res = calculateCustomsValuation({
      invoiceValue: 15000,
      freightToUSPort: 1200,
      insuranceToUSPort: 300,
      discounts: 500,
    });

    expect(res.deductionsTotal).toBe(2000); // 1200 + 300 + 500
    expect(res.customsValue).toBe(13000); // 15000 - 2000
  });

  it("flags related party transactions for scrutiny", () => {
    const res = calculateCustomsValuation({
      invoiceValue: 5000,
      relatedParty: true,
    });

    expect(res.relatedParty).toBe(true);
    expect(res.relatedPartyFlagged).toBe(true);
  });
});
