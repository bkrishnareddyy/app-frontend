import { describe, it, expect, vi, beforeEach } from "vitest";

// End-Use Screening: endUseScreening.ts orchestrator.
// Covers: missing-data-never-resolves-to-CLEAR discipline (no rules loaded,
// no stated end-use text), HIT detection, CLEAR when run with no match, and
// ERROR status derivation.

const getEndUseKeywordRules = vi.fn();

vi.mock("@/modules/agents/compliance/endUse/endUseRepository", () => ({
  getEndUseKeywordRules,
}));

const { runEndUseScreening } = await import("@/modules/agents/compliance/endUse/endUseScreening");

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    endUseStatement: null,
    screeningDate: new Date("2026-01-01"),
    ...overrides,
  } as Parameters<typeof runEndUseScreening>[0];
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule_1",
    category: "END_USE_NUCLEAR",
    phrase: "uranium enrichment",
    matchType: "CONTAINS",
    citation: "15 CFR 744.2",
    severity: "CRITICAL",
    authority: "US BIS / Dept of Commerce",
    publicationStatus: "PUBLISHED",
    publishedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runEndUseScreening: missing reference data never resolves to CLEAR", () => {
  it("reports SKIPPED when no keyword reference data is loaded", async () => {
    getEndUseKeywordRules.mockResolvedValue([]);
    const result = await runEndUseScreening(baseInput({ endUseStatement: "for uranium enrichment purposes" }));
    expect(result.status).toBe("SKIPPED");
    expect(result.skipped).toContainEqual({
      reason: "No restricted-end-use reference data is loaded (ComplianceKeywordRule table has no published END_USE_* rows).",
    });
    expect(result.hits).toHaveLength(0);
  });

  it("reports SKIPPED when no end-use statement is available, even with rules loaded", async () => {
    getEndUseKeywordRules.mockResolvedValue([rule()]);
    const result = await runEndUseScreening(baseInput({ endUseStatement: null }));
    expect(result.status).toBe("SKIPPED");
    expect(result.skipped).toContainEqual({ reason: "No end-use statement is available to screen." });
    expect(result.checksRun).toBe(0);
  });

  it("reports SKIPPED for a blank (whitespace-only) end-use statement", async () => {
    getEndUseKeywordRules.mockResolvedValue([rule()]);
    const result = await runEndUseScreening(baseInput({ endUseStatement: "   " }));
    expect(result.status).toBe("SKIPPED");
    expect(result.checksRun).toBe(0);
  });
});

describe("runEndUseScreening: restricted end-use keyword match", () => {
  it("reports a HIT when the end-use statement matches a published phrase", async () => {
    getEndUseKeywordRules.mockResolvedValue([rule()]);
    const result = await runEndUseScreening(baseInput({ endUseStatement: "Equipment for uranium enrichment facility." }));
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ category: "END_USE_NUCLEAR", matchedPhrase: "uranium enrichment" });
    expect(result.checksRun).toBe(1);
  });

  it("reports CLEAR when rules are loaded and the check runs but nothing matches", async () => {
    getEndUseKeywordRules.mockResolvedValue([rule()]);
    const result = await runEndUseScreening(baseInput({ endUseStatement: "General industrial machinery parts." }));
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(result.checksRun).toBe(1);
  });
});

describe("runEndUseScreening: status derivation for errors", () => {
  it("reports ERROR when the repository call throws", async () => {
    getEndUseKeywordRules.mockRejectedValue(new Error("db down"));
    const result = await runEndUseScreening(baseInput({ endUseStatement: "uranium enrichment" }));
    expect(result.status).toBe("ERROR");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "REPOSITORY_ERROR" });
    expect(result.hits).toHaveLength(0);
  });
});

describe("runEndUseScreening: tenant safety", () => {
  it("never forwards accountId into the repository layer -- reference data is shared", async () => {
    getEndUseKeywordRules.mockResolvedValue([]);
    await runEndUseScreening(baseInput({ accountId: "acct_1" }));
    expect(getEndUseKeywordRules).toHaveBeenCalledWith();
  });
});
