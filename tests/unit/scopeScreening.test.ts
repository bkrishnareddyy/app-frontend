import { describe, it, expect, vi } from "vitest";
import { screenForAdcvd } from "../../src/lib/adcvd/scopeScreening";
import { db } from "../../src/lib/db";

describe("scopeScreening", () => {
  it("returns YES for exact HTS code and respondent country match", async () => {
    vi.spyOn(db.adcvdOrder, "findMany").mockResolvedValueOnce([
      {
        id: "order_1",
        caseNumber: "A-570-979",
        title: "Crystalline Silicon Photovoltaic Cells from China",
        petitioner: "SolarWorld",
        respondentCountries: ["CN", "VN"],
        htsCodesInScope: ["8541.40.6025"],
        scopeLanguage: "Crystalline silicon photovoltaic cells and modules",
        effectiveDate: new Date(),
        suspensionAgreement: false,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await screenForAdcvd({
      htsCode: "8541.40.6025",
      countryOfOrigin: "CN",
      productDescription: "Solar Panel Module 400W",
    });

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].inScope).toBe("YES");
    expect(res.orders[0].confidence).toBe(95);
  });

  it("returns POSSIBLY when HTS code matches but country of origin is non-respondent", async () => {
    vi.spyOn(db.adcvdOrder, "findMany").mockResolvedValueOnce([
      {
        id: "order_1",
        caseNumber: "A-570-979",
        title: "Crystalline Silicon Photovoltaic Cells from China",
        petitioner: "SolarWorld",
        respondentCountries: ["CN"],
        htsCodesInScope: ["8541.40.6025"],
        scopeLanguage: "Crystalline silicon photovoltaic cells and modules",
        effectiveDate: new Date(),
        suspensionAgreement: false,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await screenForAdcvd({
      htsCode: "8541.40.6025",
      countryOfOrigin: "MX", // Mexico, not China
      productDescription: "Solar Panel Module 400W",
    });

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].inScope).toBe("POSSIBLY");
  });

  it("returns empty orders array (NO) for HTS codes not covered by any active order", async () => {
    vi.spyOn(db.adcvdOrder, "findMany").mockResolvedValueOnce([]);

    const res = await screenForAdcvd({
      htsCode: "8481.80.5090",
      countryOfOrigin: "DE",
      productDescription: "Stainless Steel Valve",
    });

    expect(res.orders).toHaveLength(0);
  });
});
