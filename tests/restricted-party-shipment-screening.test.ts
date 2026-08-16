import { describe, it, expect, vi, beforeEach } from "vitest";

// Restricted / Denied-Party Screening: shipmentScreening.ts
// Covers: no shipment parties -> SKIPPED (never CLEAR), worst-of-outcomes
// aggregation across parties/passes, suppressed matches excluded from
// `hits`, red-flag hits collected independently, and errors/skips surfaced
// per party.

const getShipmentPartiesForScreening = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/restrictedPartyRepository", () => ({
  getShipmentPartiesForScreening,
}));

const runRestrictedPartyScreening = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/restrictedPartyScreening", () => ({
  runRestrictedPartyScreening,
}));

const persistScreeningRun = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/persistResult", () => ({
  persistScreeningRun,
}));

const { runRestrictedPartyScreeningForShipment } = await import(
  "@/modules/agents/compliance/restrictedParty/shipmentScreening"
);

function shipmentParty(overrides: Record<string, unknown> = {}) {
  return {
    shipmentPartyId: "sp_1",
    role: "Consignee",
    legalEntityId: "le_1",
    partyId: "party_1",
    name: "Acme Trading Co",
    address: null,
    city: null,
    country: "US",
    contactName: null,
    ...overrides,
  };
}

function pass(overrides: Record<string, unknown> = {}) {
  return {
    passType: "PARTY_NAME",
    status: "CLEAR",
    matches: [],
    redFlagHits: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function match(overrides: Record<string, unknown> = {}) {
  return {
    matchedName: "Acme Trading Co",
    sourceList: "SDN",
    nameScore: 100,
    matchMethod: "EXACT",
    tier: "HIT",
    suppressedByApprovedParty: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  persistScreeningRun.mockResolvedValue([]);
});

describe("runRestrictedPartyScreeningForShipment: no shipment parties never resolves to CLEAR", () => {
  it("reports SKIPPED when the shipment has no parties to screen", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([]);
    const result = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(result.status).toBe("SKIPPED");
    expect(result.partiesScreened).toBe(0);
    expect(result.skipped).toContainEqual({ role: "ALL", reason: "No shipment parties are available to screen." });
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });
});

describe("runRestrictedPartyScreeningForShipment: aggregation across parties", () => {
  it("reports CLEAR when every party clears", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([shipmentParty()]);
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [pass({ status: "CLEAR" })] });

    const result = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(result.partiesScreened).toBe(1);
  });

  it("rolls up to the worst status across multiple parties", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([
      shipmentParty({ shipmentPartyId: "sp_1", role: "Consignee", name: "Clean Party" }),
      shipmentParty({ shipmentPartyId: "sp_2", role: "Shipper", name: "Bad Actor Corp" }),
    ]);
    runRestrictedPartyScreening
      .mockResolvedValueOnce({ correlationId: "corr_1", passes: [pass({ status: "CLEAR" })] })
      .mockResolvedValueOnce({
        correlationId: "corr_2",
        passes: [pass({ status: "HIT", matches: [match()] })],
      });

    const result = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ role: "Shipper", tier: "HIT", sourceList: "SDN" });
  });

  it("excludes suppressed matches from hits but still reflects them in the resulting status", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([shipmentParty()]);
    runRestrictedPartyScreening.mockResolvedValue({
      correlationId: "corr_1",
      passes: [pass({ status: "CLEAR", matches: [match({ suppressedByApprovedParty: true })] })],
    });

    const result = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(result.hits).toHaveLength(0);
    expect(result.status).toBe("CLEAR");
  });

  it("collects red-flag hits independently of denial-order matches", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([shipmentParty()]);
    runRestrictedPartyScreening.mockResolvedValue({
      correlationId: "corr_1",
      passes: [
        pass({
          status: "REVIEW_REQUIRED",
          matches: [],
          redFlagHits: [{ keywordRuleId: "rule_1", matchedWord: "front company" }],
        }),
      ],
    });

    const result = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(result.hits).toHaveLength(0);
    expect(result.redFlagHits).toHaveLength(1);
    expect(result.redFlagHits[0]).toMatchObject({ matchedWord: "front company", role: "Consignee" });
  });

  it("surfaces per-party skip and error entries", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([shipmentParty()]);
    runRestrictedPartyScreening.mockResolvedValue({
      correlationId: "corr_1",
      passes: [pass({ status: "SKIPPED" }), ],
    });

    const skippedResult = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(skippedResult.status).toBe("SKIPPED");
    expect(skippedResult.skipped).toContainEqual({
      role: "Consignee",
      reason: "No restricted-party reference data is loaded.",
    });

    runRestrictedPartyScreening.mockResolvedValue({
      correlationId: "corr_2",
      passes: [pass({ status: "ERROR", errorCode: "REPOSITORY_ERROR", errorMessage: "db down" })],
    });
    const erroredResult = await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(erroredResult.status).toBe("ERROR");
    expect(erroredResult.errors).toContainEqual({ role: "Consignee", code: "REPOSITORY_ERROR", message: "db down" });
  });

  it("persists every party's screening run", async () => {
    getShipmentPartiesForScreening.mockResolvedValue([
      shipmentParty({ shipmentPartyId: "sp_1" }),
      shipmentParty({ shipmentPartyId: "sp_2" }),
    ]);
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [pass()] });

    await runRestrictedPartyScreeningForShipment("acct_1", "ship_1");
    expect(persistScreeningRun).toHaveBeenCalledTimes(2);
  });
});
