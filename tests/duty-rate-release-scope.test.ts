import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A duty rate decides what an importer legally owes, so it may only ever come
 * from the currently PUBLISHED HTS release.
 *
 * The same HTS number exists in every ingested release. An unfiltered lookup
 * returned whichever row the database handed back last, which in practice meant:
 *
 *   - a DRAFT staged overnight by the nightly USITC refresh, carrying no duty
 *     rates at all, so a rated line silently became "unrated" and a filing that
 *     had been transmittable yesterday was refused today; or
 *   - a SUPERSEDED release, carrying a rate from a schedule that no longer
 *     applies, which would price the declaration against retired law.
 *
 * Which one you got depended on row order. These tests pin the release scope.
 */

const dbMock = {
  htsRelease: { findFirst: vi.fn() },
  htsNode: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { loadHtsCodesMap } = await import("@/lib/tariff/dutyEngine");

const LINE = [{ htsCode: "8481.80.5090", quantity: 1, unitPrice: 100, totalValue: 100 }];

/** A node as the lookup expects it, with a General rate attached. */
function node(rate: string | null) {
  return {
    htsNumberNormalized: "8481805090",
    dutyRates: rate === null ? [] : [{ rateColumn: "General", rawRateText: rate }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.htsRelease.findFirst.mockResolvedValue({ id: "rel_published" });
  dbMock.htsNode.findMany.mockResolvedValue([node("Free")]);
});

describe("duty rate release scope", () => {
  it("asks only for the published release", async () => {
    await loadHtsCodesMap(LINE);

    const releaseQuery = dbMock.htsRelease.findFirst.mock.calls[0][0];
    expect(releaseQuery.where.publicationStatus).toBe("PUBLISHED");
    // Newest published wins when more than one has been published over time.
    expect(releaseQuery.orderBy).toEqual({ effectiveFrom: "desc" });
  });

  it("constrains the node lookup to that release's id", async () => {
    await loadHtsCodesMap(LINE);

    const nodeQuery = dbMock.htsNode.findMany.mock.calls[0][0];
    // Without this, a DRAFT or SUPERSEDED node for the same HTS number can win
    // on row order alone.
    expect(nodeQuery.where.releaseId).toBe("rel_published");
    expect(nodeQuery.where.htsNumberNormalized).toEqual({ in: ["8481805090"] });
  });

  it("reads the published rate", async () => {
    const map = await loadHtsCodesMap(LINE);
    // "Free" is a real rate of 0%, not a missing one.
    expect(map["8481.80.5090"].generalDutyRate).toBe("Free");
  });

  it("reports unrated when no release has been published", async () => {
    dbMock.htsRelease.findFirst.mockResolvedValue(null);

    const map = await loadHtsCodesMap(LINE);

    // No lawful schedule to price against: report unrated rather than falling
    // back to a draft or a retired release. The filing guard then refuses the
    // transmission, which is the correct outcome.
    expect(map["8481.80.5090"].generalDutyRate).toBeNull();
    expect(dbMock.htsNode.findMany).not.toHaveBeenCalled();
  });

  it("does not query at all when no line carries an HTS code", async () => {
    const map = await loadHtsCodesMap([{ quantity: 1, unitPrice: 100, totalValue: 100 }]);
    expect(map).toEqual({});
    expect(dbMock.htsRelease.findFirst).not.toHaveBeenCalled();
    expect(dbMock.htsNode.findMany).not.toHaveBeenCalled();
  });

  it("leaves a code with no node in the published release unrated", async () => {
    dbMock.htsNode.findMany.mockResolvedValue([]);
    const map = await loadHtsCodesMap(LINE);
    // Never a guessed rate for a code the published schedule does not contain.
    expect(map["8481.80.5090"].generalDutyRate).toBeNull();
  });

  it("scopes by country so another country's release cannot supply the rate", async () => {
    await loadHtsCodesMap(LINE, "CA");
    expect(dbMock.htsRelease.findFirst.mock.calls[0][0].where.country).toBe("CA");
  });
});
