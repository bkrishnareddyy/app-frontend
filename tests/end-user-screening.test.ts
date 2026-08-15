import { describe, it, expect, vi, beforeEach } from "vitest";

// End-User Screening: endUserScreening.ts orchestrator.
// Covers: missing-data-never-resolves-to-CLEAR discipline, per-name skip
// reasons, HIT detection, CLEAR when run with no match, and ERROR status
// derivation.

const getEndUserEntityList = vi.fn();

vi.mock("@/modules/agents/compliance/endUser/endUserRepository", () => ({
  getEndUserEntityList,
}));

const { runEndUserScreening } = await import("@/modules/agents/compliance/endUser/endUserScreening");

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    entityNames: [],
    screeningDate: new Date("2026-01-01"),
    ...overrides,
  } as Parameters<typeof runEndUserScreening>[0];
}

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity_1",
    entityHash: "hash_1",
    entityType: "COMPANY",
    name: "Restricted Import Consortium LLC",
    alternateNames: [],
    address: null,
    city: null,
    country: "CN",
    nationalityCountry: null,
    programCodes: ["ENTITY_LIST"],
    remarks: null,
    sourceList: "ENTITY_LIST",
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

describe("runEndUserScreening: missing reference data never resolves to CLEAR", () => {
  it("reports SKIPPED when no entity-list reference data is loaded", async () => {
    getEndUserEntityList.mockResolvedValue([]);
    const result = await runEndUserScreening(
      baseInput({ entityNames: [{ role: "Importer", name: "Acme Imports" }] })
    );
    expect(result.status).toBe("SKIPPED");
    expect(result.skipped).toContainEqual({
      reason: "No BIS Entity List / Unverified List reference data is loaded (ScreeningEntity table has no published ENTITY_LIST/UNVERIFIED rows).",
    });
    expect(result.hits).toHaveLength(0);
  });

  it("skips per-name when a name is blank, even with the list loaded", async () => {
    getEndUserEntityList.mockResolvedValue([entity()]);
    const result = await runEndUserScreening(baseInput({ entityNames: [{ role: "Importer", name: "  " }] }));
    expect(result.skipped).toContainEqual({ reason: "No name available to screen.", role: "Importer" });
    expect(result.checksRun).toBe(0);
  });
});

describe("runEndUserScreening: entity-list fuzzy match", () => {
  it("reports a HIT when a screened name closely matches an entity-list entry", async () => {
    getEndUserEntityList.mockResolvedValue([entity()]);
    const result = await runEndUserScreening(
      baseInput({ entityNames: [{ role: "Importer", name: "Restricted Import Consortium LLC" }] })
    );
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      role: "Importer",
      matchedEntityName: "Restricted Import Consortium LLC",
      sourceList: "ENTITY_LIST",
      matchStatus: "BLOCKED",
    });
  });

  it("reports CLEAR when the list is loaded, checks run, but nothing matches", async () => {
    getEndUserEntityList.mockResolvedValue([entity()]);
    const result = await runEndUserScreening(
      baseInput({ entityNames: [{ role: "Exporter", name: "Totally Unrelated GmbH" }] })
    );
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(result.checksRun).toBe(1);
  });
});

describe("runEndUserScreening: status derivation for errors", () => {
  it("reports ERROR when the repository call throws", async () => {
    getEndUserEntityList.mockRejectedValue(new Error("db down"));
    const result = await runEndUserScreening(baseInput({ entityNames: [{ role: "Importer", name: "Acme" }] }));
    expect(result.status).toBe("ERROR");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "REPOSITORY_ERROR" });
  });
});

describe("runEndUserScreening: tenant safety", () => {
  it("never forwards accountId into the repository layer -- ScreeningEntity is shared reference data", async () => {
    getEndUserEntityList.mockResolvedValue([]);
    await runEndUserScreening(baseInput({ accountId: "acct_1" }));
    expect(getEndUserEntityList).toHaveBeenCalledWith();
  });
});
