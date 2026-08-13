import { describe, it, expect } from "vitest";
import { determineOrigin } from "../../src/lib/origin/originEngine";

describe("originEngine", () => {
  it("passes substantial transformation for tariff chapter change", () => {
    const res = determineOrigin({
      product: { htsCode: "8481.80.5090", description: "Stainless Steel Valve" },
      materials: [
        { name: "Raw Steel Ingot", htsCode: "7218.10.0000", cost: 20 },
      ],
      claimedCountry: "MX",
    });

    expect(res.qualifies).toBe(true);
    expect(res.basis).toBe("SUBSTANTIAL_TRANSFORMATION");
    expect(res.confidence).toBeGreaterThanOrEqual(80);
    expect(res.gaps).toHaveLength(0);
  });

  it("fails substantial transformation when material is in the same tariff chapter", () => {
    const res = determineOrigin({
      product: { htsCode: "8481.80.5090", description: "Stainless Steel Valve" },
      materials: [
        { name: "Unfinished Valve Body", htsCode: "8481.90.0000", cost: 40 },
      ],
      claimedCountry: "MX",
    });

    expect(res.qualifies).toBe(false);
    expect(res.confidence).toBeLessThan(80);
  });

  it("calculates RVC percentage and verifies USMCA chapter rules", () => {
    const res = determineOrigin({
      product: { htsCode: "8481.80.5090", description: "Stainless Steel Valve", price: 100 },
      materials: [
        { name: "Raw Steel Ingot", htsCode: "7218.10.0000", cost: 30, countryOfOrigin: "MX" },
        { name: "Foreign Seal", htsCode: "4016.93.0000", cost: 25, countryOfOrigin: "CN" },
      ],
      claimedCountry: "MX",
      tradeAgreementCode: "USMCA",
    });

    expect(res.regionalValueContentPct).toBe(75); // (100 - 25)/100 = 75%
    expect(res.qualifies).toBe(true);
  });

  it("returns a missing evidence gap when material cost is missing", () => {
    const res = determineOrigin({
      product: { htsCode: "8541.40.6025", description: "Solar Panel" },
      materials: [
        { name: "Silicon Wafer", htsCode: "3818.00.0000" }, // missing cost
      ],
      claimedCountry: "US",
      tradeAgreementCode: "USMCA",
    });

    expect(res.qualifies).toBe(false);
    expect(res.gaps).toHaveLength(1);
    expect(res.gaps[0].missing).toContain("Material cost for \"Silicon Wafer\" not entered");
  });
});
