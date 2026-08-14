import { describe, it, expect, vi, beforeEach } from "vitest";

// Country Embargo Screening: countryPairEvaluator.ts must distinguish a direct
// "Y" row (HIT), a direct "N" row (CLEAR, not "no rule"), and the true absence
// of any country_by_country_maps row (CLEAR/NO_DIRECT_COUNTRY_PAIR_RULE) --
// CountryEmbargoScreening_Prompt.md section 22.

const resolveCountries = vi.fn();
const getCountryRelationship = vi.fn();
const getCommerceControlListEntries = vi.fn();
const resolveCountryGroupEvidence = vi.fn();

vi.mock("@/modules/agents/compliance/embargo/embargoRepository", () => ({
  resolveCountries,
  getCountryRelationship,
  getCommerceControlListEntries,
}));
vi.mock("@/modules/agents/compliance/embargo/countryGroupMatcher", () => ({
  resolveCountryGroupEvidence,
}));

const { evaluateCountryPair } = await import("@/modules/agents/compliance/embargo/countryPairEvaluator");

const CN = { cySeq: 1, cyId: "CN", cyName: "China" };
const IR = { cySeq: 2, cyId: "IR", cyName: "Iran" };

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    screeningLevel: "TRANSACTION",
    complianceCountry: "CN",
    targetCountry: "IR",
    type: "D",
    screeningDate: new Date("2026-01-01"),
    accountConfig: {
      embargoScreeningEnabled: true,
      privateEmbargoEnabled: false,
      serverScreeningEnabled: true,
      genericExportLdEnabled: false,
      audited: false,
      emailAlertEnabled: false,
      generalAuditLogEnabled: false,
    },
    ...overrides,
  } as Parameters<typeof evaluateCountryPair>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveCountries.mockResolvedValue(
    new Map([
      ["CN", CN],
      ["IR", IR],
    ])
  );
  resolveCountryGroupEvidence.mockResolvedValue({
    complianceCountryGroupIds: [],
    targetCountryGroupIds: [],
    complianceCountryComplianceGroupIds: [],
    capabilityGap: true,
    reason: "gap",
  });
  getCommerceControlListEntries.mockResolvedValue([]);
});

describe("evaluateCountryPair", () => {
  it("returns HIT for a direct row with cycyIndEmbargoed = Y", async () => {
    getCountryRelationship.mockResolvedValue({
      cycySeq: 501,
      cycyFromCySeq: 1,
      cycyToCySeq: 2,
      cycyIndEmbargoed: "Y",
      cycyIndNationalSanction: "Y",
      cycyIndEuSanction: "N",
      cycyIndUnSanction: "N",
    });
    const result = await evaluateCountryPair(ctx(), "STANDARD");
    expect(result.result).toBe("HIT");
    expect(result.reason).toBe("DIRECT_COUNTRY_PAIR_EMBARGOED");
    expect(result.ruleId).toBe("501");
    expect(result.evidence?.nationalSanction).toBe(true);
  });

  it("returns CLEAR (not a missing-rule state) for a direct row with cycyIndEmbargoed = N", async () => {
    getCountryRelationship.mockResolvedValue({
      cycySeq: 502,
      cycyFromCySeq: 1,
      cycyToCySeq: 2,
      cycyIndEmbargoed: "N",
      cycyIndNationalSanction: "N",
      cycyIndEuSanction: "N",
      cycyIndUnSanction: "N",
    });
    const result = await evaluateCountryPair(ctx(), "STANDARD");
    expect(result.result).toBe("CLEAR");
    expect(result.reason).toBe("DIRECT_COUNTRY_PAIR_CLEAR");
    expect(result.ruleId).toBe("502");
  });

  it("returns CLEAR/NO_DIRECT_COUNTRY_PAIR_RULE when there is no row at all", async () => {
    getCountryRelationship.mockResolvedValue(null);
    const result = await evaluateCountryPair(ctx(), "STANDARD");
    expect(result.result).toBe("CLEAR");
    expect(result.reason).toBe("NO_DIRECT_COUNTRY_PAIR_RULE");
    expect(result.ruleId).toBeUndefined();
  });

  it("returns ERROR (never CLEAR) when either country cannot be resolved", async () => {
    resolveCountries.mockResolvedValue(new Map([["CN", CN]]));
    const result = await evaluateCountryPair(ctx(), "STANDARD");
    expect(result.result).toBe("ERROR");
    expect(result.reason).toBe("COUNTRY_NOT_RESOLVED");
    expect(getCountryRelationship).not.toHaveBeenCalled();
  });

  it("always attaches country-group evidence tagged as a capability gap, never as a determination", async () => {
    getCountryRelationship.mockResolvedValue(null);
    const result = await evaluateCountryPair(ctx(), "STANDARD");
    expect(result.evidence?.countryGroupEvidence).toMatchObject({ capabilityGap: true });
  });

  it("attaches CCL evidence only when an ECCN is present on the context", async () => {
    getCountryRelationship.mockResolvedValue(null);
    getCommerceControlListEntries.mockResolvedValue([{ cclSeq: 9, cclId: "3A001" }]);
    const result = await evaluateCountryPair(ctx({ eccn: "3A001" }), "STANDARD");
    expect(getCommerceControlListEntries).toHaveBeenCalledWith("3A001", IR.cyId);
    expect(result.evidence?.cclMatches).toEqual([{ cclSeq: 9, cclId: "3A001" }]);
  });

  it("does not query the CCL table when no ECCN is present", async () => {
    getCountryRelationship.mockResolvedValue(null);
    await evaluateCountryPair(ctx(), "STANDARD");
    expect(getCommerceControlListEntries).not.toHaveBeenCalled();
  });

  it("tags the result with the matcher name it was invoked under", async () => {
    getCountryRelationship.mockResolvedValue(null);
    const result = await evaluateCountryPair(ctx(), "GENERIC");
    expect(result.matcher).toBe("GENERIC");
  });
});
