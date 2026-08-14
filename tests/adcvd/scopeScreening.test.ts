import { describe, it, expect, vi, beforeEach } from "vitest";
import { screenForAdcvd } from "@/lib/adcvd/scopeScreening";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    adcvdOrder: {
      findMany: vi.fn(),
    },
  },
}));

describe("AD/CVD Scope Screening Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockOrders = [
    {
      id: "ord_1",
      caseNumber: "A-570-601",
      title: "Solar Cells and Modules from China",
      respondentCountries: ["CN"],
      htsCodesInScope: ["8541.40.6025", "8541.40.6015"],
      scopeLanguage: "Crystalline silicon photovoltaic cells, whether or not assembled into modules...",
      status: "ACTIVE",
    },
  ];

  it("returns NO scope match when HTS, country, and text do not match any active order", async () => {
    vi.mocked(db.adcvdOrder.findMany).mockResolvedValue(mockOrders as any);

    const result = await screenForAdcvd({
      htsCode: "8471.30.0100",
      countryOfOrigin: "DE",
      productDescription: "Portable automatic data processing machines",
    });

    expect(result.orders).toHaveLength(0);
  });

  it("returns YES scope match when HTS code and country of origin both match an active order", async () => {
    vi.mocked(db.adcvdOrder.findMany).mockResolvedValue(mockOrders as any);

    const result = await screenForAdcvd({
      htsCode: "8541.40.6025",
      countryOfOrigin: "CN",
      productDescription: "Solar photovoltaic module 400W",
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].inScope).toBe("YES");
    expect(result.orders[0].caseNumber).toBe("A-570-601");
    expect(result.orders[0].confidence).toBe(95);
  });

  it("returns POSSIBLY scope match with GRI reasoning when HTS code matches but country requires confirmation", async () => {
    vi.mocked(db.adcvdOrder.findMany).mockResolvedValue(mockOrders as any);

    const result = await screenForAdcvd({
      htsCode: "8541.40.6025",
      countryOfOrigin: "VN",
      productDescription: "Solar module assembled in Vietnam",
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].inScope).toBe("POSSIBLY");
    expect(result.orders[0].caseNumber).toBe("A-570-601");
    expect(result.orders[0].reasoning).toBeDefined();
    expect(result.orders[0].reasoning).toMatch(/GRI Analysis|country of origin/i);
  });

  it("returns POSSIBLY scope match when product description keywords match scope language", async () => {
    vi.mocked(db.adcvdOrder.findMany).mockResolvedValue(mockOrders as any);

    const result = await screenForAdcvd({
      htsCode: "9999.99.9999",
      countryOfOrigin: "DE",
      productDescription: "Crystalline silicon solar photovoltaic cell assembly",
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].inScope).toBe("POSSIBLY");
    expect(result.orders[0].confidence).toBe(50);
  });
});
