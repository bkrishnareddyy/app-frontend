import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 0 fix (Section 6): where a trade remedy (Section 301/232, AD/CVD) has
 * not actually been evaluated for an HTS code -- no ingested row to consult --
 * the engine must report NOT_EVALUATED, never a hardcoded false/0 that a
 * caller cannot distinguish from "evaluated and confirmed not applicable."
 */

const dbMock = {
  htsRelease: { findFirst: vi.fn() },
  htsNode: { findMany: vi.fn() },
  section232Rate: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { loadHtsCodesMap, resolveSection232ForHtsCode } = await import("@/lib/tariff/dutyEngine");

const LINE = (countryOfOrigin?: string) => [
  { htsCode: "7318.15.2065", quantity: 1, unitPrice: 100, totalValue: 100, countryOfOrigin },
];

function node(overrides: Partial<{ dutyRates: unknown[] }> = {}) {
  return {
    htsNumberNormalized: "7318152065",
    dutyRates: [{ rateColumn: "General", rawRateText: "Free" }],
    ...overrides,
  };
}

function section232Row(overrides: Record<string, unknown> = {}) {
  return {
    htsNumber: "7318.15.2065",
    commodity: "STEEL",
    baseRatePct: 25,
    countryOfOrigin: null,
    isGeneralApprovedExclusion: false,
    effectiveDate: new Date("2020-01-01"),
    expirationDate: null,
    reviewStatus: "APPROVED",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.htsRelease.findFirst.mockResolvedValue({ id: "rel_published" });
  dbMock.htsNode.findMany.mockResolvedValue([node()]);
  dbMock.section232Rate.findMany.mockResolvedValue([]);
});

describe("resolveSection232ForHtsCode", () => {
  it("reports NOT_EVALUATED when no Section232Rate row exists for the code", async () => {
    const result = await resolveSection232ForHtsCode("7318.15.2065");
    expect(result).toEqual({ applicable: false, additionalRate: 0, status: "NOT_EVALUATED" });
  });

  it("reports EVALUATED_APPLICABLE with the real rate when a matching row exists for all countries", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([section232Row()]);
    const result = await resolveSection232ForHtsCode("7318.15.2065");
    expect(result).toEqual({ applicable: true, additionalRate: 25, status: "EVALUATED_APPLICABLE" });
  });

  it("prefers a country-specific row over the wildcard row", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([
      section232Row({ countryOfOrigin: null, baseRatePct: 25 }),
      section232Row({ countryOfOrigin: "CN", baseRatePct: 50 }),
    ]);
    const result = await resolveSection232ForHtsCode("7318.15.2065", "CN");
    expect(result).toEqual({ applicable: true, additionalRate: 50, status: "EVALUATED_APPLICABLE" });
  });

  it("reports EVALUATED_NOT_APPLICABLE when the matching row is a general approved exclusion", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([section232Row({ isGeneralApprovedExclusion: true })]);
    const result = await resolveSection232ForHtsCode("7318.15.2065");
    expect(result).toEqual({ applicable: false, additionalRate: 0, status: "EVALUATED_NOT_APPLICABLE" });
  });

  it("excludes an expired row and reports NOT_EVALUATED", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([
      section232Row({ expirationDate: new Date("2021-01-01") }),
    ]);
    const result = await resolveSection232ForHtsCode("7318.15.2065");
    expect(result).toEqual({ applicable: false, additionalRate: 0, status: "NOT_EVALUATED" });
  });

  it("excludes a not-yet-effective row and reports NOT_EVALUATED", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([
      section232Row({ effectiveDate: new Date("2099-01-01") }),
    ]);
    const result = await resolveSection232ForHtsCode("7318.15.2065");
    expect(result).toEqual({ applicable: false, additionalRate: 0, status: "NOT_EVALUATED" });
  });

  it("reports NOT_EVALUATED for an unparseable HTS code without querying the DB", async () => {
    const result = await resolveSection232ForHtsCode("");
    expect(result).toEqual({ applicable: false, additionalRate: 0, status: "NOT_EVALUATED" });
    expect(dbMock.section232Rate.findMany).not.toHaveBeenCalled();
  });
});

describe("loadHtsCodesMap trade-remedy status fields", () => {
  it("reports NOT_EVALUATED for section301/232/AD/CVD when no data has been ingested for the code", async () => {
    const map = await loadHtsCodesMap(LINE());
    const entry = map["7318.15.2065"];
    expect(entry.section301Status).toBe("NOT_EVALUATED");
    expect(entry.section232Status).toBe("NOT_EVALUATED");
    expect(entry.antidumpingStatus).toBe("NOT_EVALUATED");
    expect(entry.countervailingStatus).toBe("NOT_EVALUATED");
    // The old bug: these silently became false/0, indistinguishable from "evaluated, not applicable."
    expect(entry.section301Applicable).toBe(false);
    expect(entry.section232Applicable).toBe(false);
  });

  it("reports DATA_UNAVAILABLE for the general rate when the code isn't in the published release", async () => {
    dbMock.htsNode.findMany.mockResolvedValue([]);
    const map = await loadHtsCodesMap(LINE());
    expect(map["7318.15.2065"].generalStatus).toBe("DATA_UNAVAILABLE");
  });

  it("reports EVALUATED_APPLICABLE for section 232 when a real row is ingested", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([section232Row()]);
    const map = await loadHtsCodesMap(LINE());
    expect(map["7318.15.2065"].section232Status).toBe("EVALUATED_APPLICABLE");
    expect(map["7318.15.2065"].section232Applicable).toBe(true);
    expect(map["7318.15.2065"].section232AdditionalRate).toBe(25);
  });

  it("reports EVALUATED_NOT_APPLICABLE for section 301 when a rate row exists but the country doesn't match", async () => {
    dbMock.htsNode.findMany.mockResolvedValue([
      node({
        dutyRates: [
          { rateColumn: "General", rawRateText: "Free" },
          { rateType: "SECTION_301", rateColumn: "Section301", adValoremPercent: 25, trancheId: "List3", exclusion: false },
        ],
      }),
    ]);
    const map = await loadHtsCodesMap(LINE("DE"));
    expect(map["7318.15.2065"].section301Status).toBe("EVALUATED_NOT_APPLICABLE");
    expect(map["7318.15.2065"].section301Applicable).toBe(false);
  });
});
