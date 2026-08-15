import { describe, it, expect, vi, beforeEach } from "vitest";

// Military End-Use / End-User Screening: militaryEndUseScreening.ts orchestrator.
// Covers: the two independent checks (military-end-use keyword match, MEU
// List entity match), missing-data-never-resolves-to-CLEAR discipline, and
// status derivation (HIT / PARTIAL / ERROR / SKIPPED / CLEAR).

const getMilitaryEndUseKeywordRules = vi.fn();
const getMilitaryEndUserList = vi.fn();

vi.mock("@/modules/agents/compliance/militaryEndUse/militaryEndUseRepository", () => ({
  getMilitaryEndUseKeywordRules,
  getMilitaryEndUserList,
}));

const { runMilitaryEndUseScreening } = await import(
  "@/modules/agents/compliance/militaryEndUse/militaryEndUseScreening"
);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    endUseStatement: null,
    entityNames: [],
    screeningDate: new Date("2026-01-01"),
    ...overrides,
  } as Parameters<typeof runMilitaryEndUseScreening>[0];
}

function keywordRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule_1",
    category: "MILITARY_END_USE",
    phrase: "military aircraft maintenance",
    matchType: "CONTAINS",
    citation: "15 CFR 744.21",
    severity: "CRITICAL",
    authority: "US BIS / Dept of Commerce",
    publicationStatus: "PUBLISHED",
    publishedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function meuEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity_1",
    entityHash: "hash_1",
    entityType: "COMPANY",
    name: "PLA Aviation Procurement Bureau",
    alternateNames: [],
    address: null,
    city: null,
    country: "CN",
    nationalityCountry: null,
    programCodes: ["MEU"],
    remarks: null,
    sourceList: "MEU_LIST",
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

describe("runMilitaryEndUseScreening: missing reference data never resolves to CLEAR", () => {
  it("reports SKIPPED for both checks when no reference data is loaded", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([]);
    getMilitaryEndUserList.mockResolvedValue([]);
    const result = await runMilitaryEndUseScreening(
      baseInput({ endUseStatement: "military aircraft maintenance depot", entityNames: [{ role: "Importer", name: "Acme" }] })
    );
    expect(result.status).toBe("SKIPPED");
    expect(result.skipped).toContainEqual({
      kind: "MILITARY_END_USE",
      reason: "No military-end-use reference data is loaded (ComplianceKeywordRule table has no published MILITARY_END_USE rows).",
    });
    expect(result.skipped).toContainEqual({
      kind: "MILITARY_END_USER",
      reason: "No Military End User (MEU) List reference data is loaded (ScreeningEntity table has no published MEU_LIST rows).",
    });
    expect(result.hits).toHaveLength(0);
  });

  it("skips the keyword check when there is no end-use statement, even with rules loaded", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([keywordRule()]);
    getMilitaryEndUserList.mockResolvedValue([]);
    const result = await runMilitaryEndUseScreening(baseInput({ endUseStatement: null }));
    expect(result.skipped).toContainEqual({ kind: "MILITARY_END_USE", reason: "No end-use statement is available to screen." });
    expect(result.militaryEndUseChecksRun).toBe(0);
  });

  it("skips per-name when a name is blank, even with the MEU list loaded", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([]);
    getMilitaryEndUserList.mockResolvedValue([meuEntity()]);
    const result = await runMilitaryEndUseScreening(baseInput({ entityNames: [{ role: "Importer", name: " " }] }));
    expect(result.skipped).toContainEqual({ kind: "MILITARY_END_USER", reason: "No name available to screen.", role: "Importer" });
    expect(result.militaryEndUserChecksRun).toBe(0);
  });
});

describe("runMilitaryEndUseScreening: military-end-use keyword match", () => {
  it("reports a HIT when the end-use statement matches a published phrase", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([keywordRule()]);
    getMilitaryEndUserList.mockResolvedValue([]);
    const result = await runMilitaryEndUseScreening(baseInput({ endUseStatement: "For military aircraft maintenance use." }));
    expect(result.status).toBe("HIT");
    expect(result.hits[0]).toMatchObject({ kind: "MILITARY_END_USE", matchedPhrase: "military aircraft maintenance" });
    expect(result.militaryEndUseChecksRun).toBe(1);
  });
});

describe("runMilitaryEndUseScreening: MEU List entity match", () => {
  it("reports a HIT when a screened name closely matches an MEU List entry", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([]);
    getMilitaryEndUserList.mockResolvedValue([meuEntity()]);
    const result = await runMilitaryEndUseScreening(
      baseInput({ entityNames: [{ role: "Importer", name: "PLA Aviation Procurement Bureau" }] })
    );
    expect(result.status).toBe("HIT");
    expect(result.hits[0]).toMatchObject({ kind: "MILITARY_END_USER", matchedEntityName: "PLA Aviation Procurement Bureau", matchStatus: "BLOCKED" });
  });

  it("reports CLEAR when both checks run but nothing matches", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([keywordRule()]);
    getMilitaryEndUserList.mockResolvedValue([meuEntity()]);
    const result = await runMilitaryEndUseScreening(
      baseInput({ endUseStatement: "General commercial logistics.", entityNames: [{ role: "Importer", name: "Totally Unrelated Co" }] })
    );
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(result.militaryEndUseChecksRun).toBe(1);
    expect(result.militaryEndUserChecksRun).toBe(1);
  });
});

describe("runMilitaryEndUseScreening: status derivation for errors", () => {
  it("reports PARTIAL when one check hits and the other errors", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([keywordRule()]);
    getMilitaryEndUserList.mockRejectedValue(new Error("db down"));
    const result = await runMilitaryEndUseScreening(baseInput({ endUseStatement: "military aircraft maintenance" }));
    expect(result.status).toBe("PARTIAL");
    expect(result.hits).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ kind: "MILITARY_END_USER", code: "REPOSITORY_ERROR" });
  });
});

describe("runMilitaryEndUseScreening: tenant safety", () => {
  it("never forwards accountId into the repository layer -- both tables are shared reference data", async () => {
    getMilitaryEndUseKeywordRules.mockResolvedValue([]);
    getMilitaryEndUserList.mockResolvedValue([]);
    await runMilitaryEndUseScreening(baseInput({ accountId: "acct_1" }));
    expect(getMilitaryEndUseKeywordRules).toHaveBeenCalledWith();
    expect(getMilitaryEndUserList).toHaveBeenCalledWith();
  });
});
