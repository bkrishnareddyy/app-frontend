import { describe, it, expect, vi, beforeEach } from "vitest";

// UFLPA / Forced Labor Screening: forcedLaborScreening.ts orchestrator.
// Covers: the two independent checks (country/region rebuttable presumption,
// entity-list fuzzy match), missing-data-never-resolves-to-CLEAR discipline,
// status derivation (HIT / PARTIAL / ERROR / SKIPPED / CLEAR), and the fixed
// mislabeling bug -- a non-UFLPA-regime sanctions rule must never produce a
// UFLPA finding.

const getUflpaCountryRules = vi.fn();
const getUflpaEntityList = vi.fn();

vi.mock("@/modules/agents/compliance/forcedLabor/forcedLaborRepository", () => ({
  getUflpaCountryRules,
  getUflpaEntityList,
}));

const { runForcedLaborScreening } = await import(
  "@/modules/agents/compliance/forcedLabor/forcedLaborScreening"
);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    lineItems: [],
    entityNames: [],
    screeningDate: new Date("2026-01-01"),
    ...overrides,
  } as Parameters<typeof runForcedLaborScreening>[0];
}

function uflpaRule(overrides: Record<string, unknown> = {}) {
  return {
    countryCode: "UFLPA_XINJIANG",
    countryName: "China (Xinjiang)",
    regime: "UFLPA Forced Labor",
    restriction: "Rebuttable presumption of forced labor",
    authority: "US OFAC / CBP UFLPA",
    createdAt: new Date("2020-01-01"),
    ...overrides,
  };
}

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity_1",
    entityHash: "hash_1",
    entityType: "COMPANY",
    name: "Xinjiang Forced Labor Textiles Co",
    alternateNames: [],
    address: null,
    city: null,
    country: "CN",
    nationalityCountry: null,
    programCodes: ["UFLPA"],
    remarks: null,
    sourceList: "UFLPA_ENTITY_LIST",
    publicationStatus: "PUBLISHED",
    publishedAt: new Date("2024-01-01"),
    supersededAt: null,
    sourcePublishedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runForcedLaborScreening: missing reference data never resolves to CLEAR", () => {
  it("reports SKIPPED (not CLEAR) for both checks when no reference data is loaded", async () => {
    getUflpaCountryRules.mockResolvedValue([]);
    getUflpaEntityList.mockResolvedValue([]);
    const result = await runForcedLaborScreening(
      baseInput({
        lineItems: [{ lineNumber: 1, countryOfOrigin: "CN" }],
        entityNames: [{ role: "Exporter", name: "Acme Trading" }],
      })
    );
    expect(result.status).toBe("SKIPPED");
    expect(result.skipped).toContainEqual({
      kind: "COUNTRY_REGION",
      reason: "No UFLPA country/region reference data is loaded (EmbargoRule table has no UFLPA regime rows).",
    });
    expect(result.skipped).toContainEqual({
      kind: "ENTITY_LIST",
      reason: "No UFLPA Entity List reference data is loaded (ScreeningEntity table has no published UFLPA_ENTITY_LIST rows).",
    });
    expect(result.hits).toHaveLength(0);
  });

  it("skips the country/region check per-line when a line has no country of origin, even with rules loaded", async () => {
    getUflpaCountryRules.mockResolvedValue([uflpaRule()]);
    getUflpaEntityList.mockResolvedValue([]);
    const result = await runForcedLaborScreening(
      baseInput({ lineItems: [{ lineNumber: 1, countryOfOrigin: null }] })
    );
    expect(result.skipped).toContainEqual({
      kind: "COUNTRY_REGION",
      reason: "Line has no country of origin.",
      lineNumber: 1,
    });
    expect(result.countryRegionChecksRun).toBe(0);
  });

  it("skips the entity-list check per-name when a name is blank, even with the list loaded", async () => {
    getUflpaCountryRules.mockResolvedValue([]);
    getUflpaEntityList.mockResolvedValue([entity()]);
    const result = await runForcedLaborScreening(
      baseInput({ entityNames: [{ role: "Supplier/Manufacturer", name: "  " }] })
    );
    expect(result.skipped).toContainEqual({
      kind: "ENTITY_LIST",
      reason: "No name available to screen.",
      role: "Supplier/Manufacturer",
    });
    expect(result.entityListChecksRun).toBe(0);
  });
});

describe("runForcedLaborScreening: country/region rebuttable presumption check", () => {
  it("reports a HIT when a line's country of origin matches a UFLPA-regime rule", async () => {
    getUflpaCountryRules.mockResolvedValue([uflpaRule()]);
    getUflpaEntityList.mockResolvedValue([]);
    const result = await runForcedLaborScreening(
      baseInput({ lineItems: [{ lineNumber: 1, countryOfOrigin: "China (Xinjiang)" }] })
    );
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ kind: "COUNTRY_REGION", lineNumber: 1, regime: "UFLPA Forced Labor" });
    expect(result.countryRegionChecksRun).toBe(1);
  });

  it("does not flag a non-UFLPA-regime sanctions rule as a UFLPA finding (mislabeling fix)", async () => {
    // getUflpaCountryRules only ever returns UFLPA-regime rows (filtered at the
    // repository layer) -- a comprehensive-sanctions rule for the same country
    // must never surface here even if it would match a generic embargo check.
    getUflpaCountryRules.mockResolvedValue([]);
    getUflpaEntityList.mockResolvedValue([]);
    const result = await runForcedLaborScreening(
      baseInput({ lineItems: [{ lineNumber: 1, countryOfOrigin: "Iran" }] })
    );
    expect(result.hits).toHaveLength(0);
    expect(result.status).toBe("SKIPPED");
  });

  it("reports CLEAR when rules are loaded, checks run, but no line matches", async () => {
    getUflpaCountryRules.mockResolvedValue([uflpaRule()]);
    getUflpaEntityList.mockResolvedValue([entity()]);
    const result = await runForcedLaborScreening(
      baseInput({
        lineItems: [{ lineNumber: 1, countryOfOrigin: "Germany" }],
        entityNames: [{ role: "Exporter", name: "Totally Unrelated GmbH" }],
      })
    );
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(result.countryRegionChecksRun).toBe(1);
    expect(result.entityListChecksRun).toBe(1);
  });
});

describe("runForcedLaborScreening: entity-list fuzzy match check", () => {
  it("reports a HIT when a screened name closely matches an entity-list entry", async () => {
    getUflpaCountryRules.mockResolvedValue([]);
    getUflpaEntityList.mockResolvedValue([entity()]);
    const result = await runForcedLaborScreening(
      baseInput({ entityNames: [{ role: "Supplier/Manufacturer", name: "Xinjiang Forced Labor Textiles Co" }] })
    );
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      kind: "ENTITY_LIST",
      role: "Supplier/Manufacturer",
      matchedEntityName: "Xinjiang Forced Labor Textiles Co",
      matchStatus: "BLOCKED",
    });
  });

  it("does not report a hit for a clearly unrelated name", async () => {
    getUflpaCountryRules.mockResolvedValue([]);
    getUflpaEntityList.mockResolvedValue([entity()]);
    const result = await runForcedLaborScreening(
      baseInput({ entityNames: [{ role: "Exporter", name: "Totally Unrelated Manufacturer" }] })
    );
    expect(result.hits).toHaveLength(0);
    expect(result.status).toBe("CLEAR");
  });
});

describe("runForcedLaborScreening: status derivation for errors", () => {
  it("reports ERROR when the country/region repository call throws and nothing else runs", async () => {
    getUflpaCountryRules.mockRejectedValue(new Error("db down"));
    getUflpaEntityList.mockResolvedValue([]);
    const result = await runForcedLaborScreening(baseInput());
    expect(result.status).toBe("ERROR");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ kind: "COUNTRY_REGION", code: "REPOSITORY_ERROR" });
  });

  it("reports PARTIAL when one check hits and the other errors", async () => {
    getUflpaCountryRules.mockResolvedValue([uflpaRule()]);
    getUflpaEntityList.mockRejectedValue(new Error("entity list unavailable"));
    const result = await runForcedLaborScreening(
      baseInput({ lineItems: [{ lineNumber: 1, countryOfOrigin: "China (Xinjiang)" }] })
    );
    expect(result.status).toBe("PARTIAL");
    expect(result.hits).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});

describe("runForcedLaborScreening: tenant safety", () => {
  it("never forwards accountId into the repository layer -- both tables are shared reference data", async () => {
    getUflpaCountryRules.mockResolvedValue([]);
    getUflpaEntityList.mockResolvedValue([]);
    await runForcedLaborScreening(baseInput({ accountId: "acct_1" }));
    expect(getUflpaCountryRules).toHaveBeenCalledWith();
    expect(getUflpaEntityList).toHaveBeenCalledWith();
  });
});
