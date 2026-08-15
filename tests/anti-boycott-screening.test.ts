import { describe, it, expect, vi, beforeEach } from "vitest";

// Anti-Boycott Screening: antiBoycottScreening.ts orchestrator.
// Covers: the two independent checks (country flag, document-language
// keyword match), missing-data-never-resolves-to-CLEAR discipline, status
// derivation (HIT / PARTIAL / ERROR / SKIPPED / CLEAR), and unresolvable
// country reporting ERROR rather than a silent CLEAR.

const resolveBoycottCountry = vi.fn();
const getAntiBoycottKeywordRules = vi.fn();

vi.mock("@/modules/agents/compliance/antiBoycott/antiBoycottRepository", () => ({
  resolveBoycottCountry,
  getAntiBoycottKeywordRules,
}));

const { runAntiBoycottScreening } = await import(
  "@/modules/agents/compliance/antiBoycott/antiBoycottScreening"
);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    shipmentId: "ship_1",
    destinationCountry: null,
    documentNarrativeText: null,
    screeningDate: new Date("2026-01-01"),
    ...overrides,
  } as Parameters<typeof runAntiBoycottScreening>[0];
}

function country(overrides: Record<string, unknown> = {}) {
  return {
    cySeq: 1,
    cyId: "SA",
    cyName: "Saudi Arabia",
    cyShortName: "Saudi Arabia",
    cyIndEmbargoed: null,
    cyIndBoycotted: "Y",
    cyIndDps: null,
    cyIndLds: null,
    cyIndEms: null,
    cyIndGlds: null,
    cyDtCrt: new Date("2020-01-01"),
    cyDtUpd: new Date("2020-01-01"),
    ...overrides,
  };
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule_1",
    category: "ANTI_BOYCOTT_REQUEST",
    phrase: "goods not of Israeli origin",
    matchType: "CONTAINS",
    citation: "15 CFR 760.2",
    severity: "HIGH",
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

describe("runAntiBoycottScreening: missing data never resolves to CLEAR", () => {
  it("reports SKIPPED for both checks when no destination country and no reference data is loaded", async () => {
    getAntiBoycottKeywordRules.mockResolvedValue([]);
    const result = await runAntiBoycottScreening(baseInput());
    expect(result.status).toBe("SKIPPED");
    expect(result.skipped).toContainEqual({ kind: "COUNTRY", reason: "No destination country is available to screen." });
    expect(result.skipped).toContainEqual({
      kind: "DOCUMENT_LANGUAGE",
      reason: "No boycott-request language reference data is loaded (ComplianceKeywordRule table has no published ANTI_BOYCOTT_REQUEST rows).",
    });
    expect(result.hits).toHaveLength(0);
  });

  it("skips the document-language check when there is no narrative text, even with rules loaded", async () => {
    getAntiBoycottKeywordRules.mockResolvedValue([rule()]);
    const result = await runAntiBoycottScreening(baseInput({ documentNarrativeText: null }));
    expect(result.skipped).toContainEqual({ kind: "DOCUMENT_LANGUAGE", reason: "No transaction document/narrative text is available to screen." });
    expect(result.documentChecksRun).toBe(0);
  });

  it("reports ERROR (not CLEAR) when the destination country cannot be resolved", async () => {
    resolveBoycottCountry.mockResolvedValue(null);
    getAntiBoycottKeywordRules.mockResolvedValue([]);
    const result = await runAntiBoycottScreening(baseInput({ destinationCountry: "Nowhereistan" }));
    expect(result.errors).toContainEqual({
      kind: "COUNTRY",
      code: "UNRESOLVABLE_COUNTRY",
      message: 'Destination country "Nowhereistan" could not be resolved against the countries reference table.',
    });
    expect(result.countryChecksRun).toBe(0);
  });
});

describe("runAntiBoycottScreening: country check", () => {
  it("reports a HIT when the destination country is flagged as boycotting", async () => {
    resolveBoycottCountry.mockResolvedValue(country());
    getAntiBoycottKeywordRules.mockResolvedValue([]);
    const result = await runAntiBoycottScreening(baseInput({ destinationCountry: "Saudi Arabia" }));
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ kind: "COUNTRY", country: "Saudi Arabia" });
    expect(result.countryChecksRun).toBe(1);
  });

  it("reports CLEAR when the country resolves but is not flagged as boycotting", async () => {
    resolveBoycottCountry.mockResolvedValue(country({ cyIndBoycotted: null }));
    getAntiBoycottKeywordRules.mockResolvedValue([rule()]);
    const result = await runAntiBoycottScreening(
      baseInput({ destinationCountry: "Saudi Arabia", documentNarrativeText: "Standard purchase order terms." })
    );
    expect(result.status).toBe("CLEAR");
    expect(result.hits).toHaveLength(0);
    expect(result.countryChecksRun).toBe(1);
    expect(result.documentChecksRun).toBe(1);
  });
});

describe("runAntiBoycottScreening: document-language check", () => {
  it("reports a HIT when document text matches a published boycott-request phrase", async () => {
    getAntiBoycottKeywordRules.mockResolvedValue([rule()]);
    const result = await runAntiBoycottScreening(
      baseInput({ documentNarrativeText: "Certificate confirms goods not of Israeli origin." })
    );
    expect(result.status).toBe("HIT");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ kind: "DOCUMENT_LANGUAGE", matchedPhrase: "goods not of Israeli origin" });
  });
});

describe("runAntiBoycottScreening: status derivation for errors", () => {
  it("reports PARTIAL when the country check hits and the document check errors", async () => {
    resolveBoycottCountry.mockResolvedValue(country());
    getAntiBoycottKeywordRules.mockRejectedValue(new Error("db down"));
    const result = await runAntiBoycottScreening(baseInput({ destinationCountry: "Saudi Arabia" }));
    expect(result.status).toBe("PARTIAL");
    expect(result.hits).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
