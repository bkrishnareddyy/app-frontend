import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 0 fix (Section 6), second site: HtsNodeRepository.toDutyRateInput()
 * used to hardcode section301/232 to false/0 with a comment claiming no real
 * trade-remedy data existed anywhere, even though Section 301 data lives on
 * the node's own dutyRates and Section 232 data lives in the real, ingested
 * Section232Rate table. This now reads both honestly instead of fabricating
 * "not applicable."
 */

const dbMock = {
  section232Rate: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { HtsNodeRepository } = await import("@/repositories/htsNodeRepository");

function node(dutyRates: unknown[]) {
  return {
    id: "node_1",
    htsNumberDisplay: "7318.15.2065",
    htsNumberNormalized: "7318152065",
    dutyRates,
  } as Parameters<typeof HtsNodeRepository.toDutyRateInput>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.section232Rate.findMany.mockResolvedValue([]);
});

describe("HtsNodeRepository.toDutyRateInput", () => {
  it("reports NOT_EVALUATED for section301/232 when no data has been ingested", async () => {
    const result = await HtsNodeRepository.toDutyRateInput(node([{ rateColumn: "General", rawRateText: "Free" }]));
    expect(result.section301Status).toBe("NOT_EVALUATED");
    expect(result.section232Status).toBe("NOT_EVALUATED");
    expect(result.section301Applicable).toBe(false);
    expect(result.section232Applicable).toBe(false);
  });

  it("reads a real Section 301 rate from the node's own dutyRates", async () => {
    const result = await HtsNodeRepository.toDutyRateInput(
      node([
        { rateColumn: "General", rawRateText: "Free" },
        { rateType: "SECTION_301", rateColumn: "Section301", adValoremPercent: 25 },
      ]),
      "CN"
    );
    expect(result.section301Status).toBe("EVALUATED_APPLICABLE");
    expect(result.section301Applicable).toBe(true);
    expect(result.section301AdditionalRate).toBe(25);
  });

  it("reads a real Section 232 rate from the ingested Section232Rate table", async () => {
    dbMock.section232Rate.findMany.mockResolvedValue([
      {
        htsNumber: "7318.15.2065",
        baseRatePct: 25,
        countryOfOrigin: null,
        isGeneralApprovedExclusion: false,
        effectiveDate: new Date("2020-01-01"),
        expirationDate: null,
        reviewStatus: "APPROVED",
      },
    ]);
    const result = await HtsNodeRepository.toDutyRateInput(node([{ rateColumn: "General", rawRateText: "Free" }]));
    expect(result.section232Status).toBe("EVALUATED_APPLICABLE");
    expect(result.section232Applicable).toBe(true);
    expect(result.section232AdditionalRate).toBe(25);
  });

  it("reports DATA_UNAVAILABLE for the general status when there is no node", async () => {
    const result = await HtsNodeRepository.toDutyRateInput(null);
    expect(result.generalStatus).toBe("DATA_UNAVAILABLE");
    expect(result.section301Status).toBe("NOT_EVALUATED");
    expect(result.section232Status).toBe("NOT_EVALUATED");
  });
});
