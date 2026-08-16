import { describe, it, expect, vi, beforeEach } from "vitest";

// Restricted / Denied-Party Screening: restrictedPartyScreening.ts orchestrator.
// Covers: missing-reference-data-never-resolves-to-CLEAR discipline, required-field
// validation (ERROR, never CLEAR), exact/fuzzy match tiers, red-flag hits as
// independent of denial-order matches, party-name vs. contact-name passes never
// sharing candidate accumulation, approved-party suppression, and status
// derivation (HIT / REVIEW_REQUIRED / PARTIAL / ERROR / SKIPPED / CLEAR).

const getRestrictedPartyReferenceList = vi.fn();
const getRedFlagRules = vi.fn();
const getApprovedDispositions = vi.fn();

vi.mock("@/modules/agents/compliance/restrictedParty/restrictedPartyRepository", () => ({
  getRestrictedPartyReferenceList,
  getRedFlagRules,
  getApprovedDispositions,
}));

const { runRestrictedPartyScreening } = await import(
  "@/modules/agents/compliance/restrictedParty/restrictedPartyScreening"
);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    source: "PUBLIC_API",
    identity: { name: "Acme Trading Co" },
    ...overrides,
  } as Parameters<typeof runRestrictedPartyScreening>[0];
}

function screeningEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity_1",
    entityHash: "hash_1",
    entityType: "COMPANY",
    name: "Acme Trading Co",
    alternateNames: [],
    address: null,
    city: null,
    country: null,
    nationalityCountry: null,
    programCodes: ["SDN"],
    remarks: null,
    sourceList: "SDN",
    publicationStatus: "PUBLISHED",
    publishedAt: new Date("2024-01-01"),
    supersededAt: null,
    sourcePublishedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function redFlagRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule_1",
    phrase: "front company",
    matchType: "CONTAINS",
    category: "RESTRICTED_PARTY_RED_FLAG",
    publicationStatus: "PUBLISHED",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApprovedDispositions.mockResolvedValue(new Map());
});

describe("runRestrictedPartyScreening: missing reference data never resolves to CLEAR", () => {
  it("reports SKIPPED (not CLEAR) when no denial-order reference data and no red-flag rules are loaded", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(baseInput());
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].status).toBe("SKIPPED");
    expect(result.passes[0].matches).toHaveLength(0);
    expect(result.passes[0].redFlagHits).toHaveLength(0);
  });
});

describe("runRestrictedPartyScreening: required-field validation", () => {
  it("reports ERROR (never CLEAR) when the name is blank", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(baseInput({ identity: { name: "   " } }));
    expect(result.passes[0].status).toBe("ERROR");
    expect(result.passes[0].errorCode).toBe("MISSING_NAME");
  });

  it("reports ERROR when nameThreshold is out of range", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(baseInput({ nameThreshold: 150 }));
    expect(result.passes[0].status).toBe("ERROR");
    expect(result.passes[0].errorCode).toBe("INVALID_THRESHOLD");
  });

  it("reports ERROR when countryMatchRequired is set but no country is provided", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(baseInput({ countryMatchRequired: true }));
    expect(result.passes[0].status).toBe("ERROR");
    expect(result.passes[0].errorCode).toBe("MISSING_COUNTRY_FOR_COUNTRY_MATCH");
  });
});

describe("runRestrictedPartyScreening: denial-order matching", () => {
  it("reports a HIT for an exact name match", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([screeningEntity()]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Trading Co" } })
    );
    expect(result.passes[0].status).toBe("HIT");
    expect(result.passes[0].matches).toHaveLength(1);
    expect(result.passes[0].matches[0]).toMatchObject({ tier: "HIT", matchMethod: "EXACT" });
  });

  it("reports REVIEW_REQUIRED for a partial word-overlap match below the HIT threshold", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([
      screeningEntity({ name: "Consolidated Acme Metals" }),
    ]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Consolidated Traders" } })
    );
    expect(result.passes[0].status).toBe("REVIEW_REQUIRED");
    expect(result.passes[0].matches).toHaveLength(1);
    expect(result.passes[0].matches[0].tier).toBe("REVIEW_REQUIRED");
  });

  it("reports CLEAR when reference data and red-flag rules are loaded, checks run, but nothing matches", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([screeningEntity({ name: "Totally Unrelated Corp" })]);
    getRedFlagRules.mockResolvedValue([redFlagRule()]);
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Widgets International" } })
    );
    expect(result.passes[0].status).toBe("CLEAR");
    expect(result.passes[0].matches).toHaveLength(0);
    expect(result.passes[0].redFlagHits).toHaveLength(0);
  });
});

describe("runRestrictedPartyScreening: red-flag word check", () => {
  it("reports a red-flag hit independent of (and even absent) any denial-order match", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([redFlagRule({ phrase: "front company" })]);
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Front Company Ltd" } })
    );
    expect(result.passes[0].matches).toHaveLength(0);
    expect(result.passes[0].redFlagHits).toHaveLength(1);
    expect(result.passes[0].redFlagHits[0]).toMatchObject({ matchedWord: "front company" });
    expect(result.passes[0].status).toBe("REVIEW_REQUIRED");
  });

  it("skips the red-flag check entirely when redFlagCheckEnabled is false", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([redFlagRule({ phrase: "front company" })]);
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Front Company Ltd" }, redFlagCheckEnabled: false })
    );
    expect(result.passes[0].redFlagHits).toHaveLength(0);
    expect(result.passes[0].status).toBe("SKIPPED");
  });
});

describe("runRestrictedPartyScreening: party-name and contact-name passes never share candidate accumulation", () => {
  it("runs a separate contact-name pass only when a contact name is present, independent of the party-name pass", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([
      screeningEntity({ id: "entity_party", name: "Acme Trading Co" }),
      screeningEntity({ id: "entity_contact", name: "Jane Contact Person" }),
    ]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Trading Co", contactName: "Jane Contact Person" } })
    );
    expect(result.passes).toHaveLength(2);
    const partyPass = result.passes.find((p) => p.passType === "PARTY_NAME")!;
    const contactPass = result.passes.find((p) => p.passType === "CONTACT_NAME")!;
    expect(partyPass.matches.map((m) => m.screeningEntityId)).toEqual(["entity_party"]);
    expect(contactPass.matches.map((m) => m.screeningEntityId)).toEqual(["entity_contact"]);
  });

  it("does not run a contact-name pass when no contact name is provided", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(baseInput());
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].passType).toBe("PARTY_NAME");
  });
});

describe("runRestrictedPartyScreening: approved-party suppression", () => {
  it("flags but does not delete a suppressed match, and does not count it toward a HIT status", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([screeningEntity()]);
    getRedFlagRules.mockResolvedValue([]);
    getApprovedDispositions.mockResolvedValue(new Map([["entity_1", "disposition_1"]]));
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Trading Co" }, partyId: "party_1" })
    );
    expect(result.passes[0].matches).toHaveLength(1);
    expect(result.passes[0].matches[0]).toMatchObject({
      suppressedByApprovedParty: true,
      suppressingDispositionId: "disposition_1",
    });
    expect(result.passes[0].status).toBe("CLEAR");
  });

  it("does not look up approved dispositions when no partyId is given (ad-hoc screening)", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    await runRestrictedPartyScreening(baseInput());
    expect(getApprovedDispositions).not.toHaveBeenCalled();
  });
});

describe("runRestrictedPartyScreening: status derivation for errors", () => {
  it("reports ERROR when the reference-list repository call throws and nothing else runs", async () => {
    getRestrictedPartyReferenceList.mockRejectedValue(new Error("db down"));
    getRedFlagRules.mockResolvedValue([]);
    const result = await runRestrictedPartyScreening(baseInput());
    expect(result.passes[0].status).toBe("ERROR");
    expect(result.passes[0].errorCode).toBe("REPOSITORY_ERROR");
  });

  it("reports PARTIAL when a denial-order hit is found but the red-flag repository call fails", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([screeningEntity()]);
    getRedFlagRules.mockRejectedValue(new Error("keyword rules unavailable"));
    const result = await runRestrictedPartyScreening(
      baseInput({ identity: { name: "Acme Trading Co" } })
    );
    expect(result.passes[0].status).toBe("PARTIAL");
    expect(result.passes[0].matches).toHaveLength(1);
    expect(result.passes[0].errorMessage).toContain("keyword rules unavailable");
  });
});

describe("runRestrictedPartyScreening: tenant safety", () => {
  it("never forwards accountId into the shared reference-data repository calls", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    await runRestrictedPartyScreening(baseInput({ accountId: "acct_1" }));
    expect(getRestrictedPartyReferenceList).toHaveBeenCalledWith();
    expect(getRedFlagRules).toHaveBeenCalledWith();
  });

  it("scopes approved-disposition lookups to the requesting account and party", async () => {
    getRestrictedPartyReferenceList.mockResolvedValue([]);
    getRedFlagRules.mockResolvedValue([]);
    await runRestrictedPartyScreening(baseInput({ accountId: "acct_1", partyId: "party_1" }));
    expect(getApprovedDispositions).toHaveBeenCalledWith("acct_1", "party_1");
  });
});
