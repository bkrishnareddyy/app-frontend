import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 0 fix (Section 5): the HTS Classification Agent must never surface an
// LLM-cited CBP CROSS ruling number as trusted evidence without confirming it
// against the persisted Qubere CROSS corpus via CrossIngestionService.verifyCitation().
// These tests drive the agent through its real Gemini branch (mocking only the
// network boundary) and assert that unverified/fabricated ruling numbers never
// survive into the returned classification.

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
  Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY", INTEGER: "INTEGER" },
}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    ruling: { findUnique: vi.fn() },
    agentDecision: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: "dec_1", ...data })) },
    agentPolicyConfig: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit_1" }),
  AuditAction: { DECISION_AUTO_APPROVED: "DECISION_AUTO_APPROVED", AGENT_EXECUTION_COMPLETED: "AGENT_EXECUTION_COMPLETED" },
}));
vi.mock("@/lib/ai/aiMeter", () => ({ meterGeminiCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ai/aiModel", () => ({ aiModel: () => "gemini-test-model" }));
vi.mock("@/modules/intake/documentIntakeAgent", () => ({ agentEventBus: { emit: vi.fn() } }));
vi.mock("@/repositories/htsNodeRepository", () => ({
  HtsNodeRepository: {
    searchNodes: vi.fn().mockResolvedValue({ items: [] }),
    findByNormalizedCode: vi.fn().mockResolvedValue(null),
  },
}));

import { HTSClassificationAgent } from "@/modules/agents/htsClassificationAgent";

function mockGeminiResponse(overrides: Partial<Record<string, unknown>> = {}) {
  generateContentMock.mockResolvedValueOnce({
    text: JSON.stringify({
      htsCode: "7318.15.2065",
      htsDescription: "Screws and bolts of stainless steel",
      dutyRate: "Free",
      griCitations: ["GRI 1"],
      crossRulings: [],
      confidence: 90,
      legalRationale: "GRI 1 resolves this directly under heading 7318.",
      ...overrides,
    }),
  });
}

describe("HTS Classification Agent: CROSS citation zero-hallucination verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.agentPolicyConfig.findFirst.mockResolvedValue(null);
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("keeps a CROSS ruling citation that resolves in the persisted corpus", async () => {
    dbMock.ruling.findUnique.mockResolvedValue({ id: "ruling_1", rulingNumber: "NY N012345" });
    mockGeminiResponse({ crossRulings: ["NY N012345"] });

    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });

    expect(res.classifications[0].crossRulings).toEqual(["NY N012345"]);
  });

  it("discards a fabricated ruling number that does not exist in the CROSS corpus", async () => {
    dbMock.ruling.findUnique.mockResolvedValue(null);
    mockGeminiResponse({ crossRulings: ["HQ999999999_FAKE"] });

    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });

    expect(res.classifications[0].crossRulings).toEqual([]);
  });

  it("discards a real-looking but wrong/unresolvable ruling number", async () => {
    dbMock.ruling.findUnique.mockResolvedValue(null);
    mockGeminiResponse({ crossRulings: ["NY N999999"] });

    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });

    expect(res.classifications[0].crossRulings).toEqual([]);
  });

  it("keeps only the verified citation out of a mixed valid/fabricated set", async () => {
    dbMock.ruling.findUnique.mockImplementation(async ({ where }: { where: { rulingNumber: string } }) =>
      where.rulingNumber === "NY N012345" ? { id: "ruling_1", rulingNumber: "NY N012345" } : null
    );
    mockGeminiResponse({ crossRulings: ["NY N012345", "HQ000000000_FAKE"] });

    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });

    expect(res.classifications[0].crossRulings).toEqual(["NY N012345"]);
  });

  it("passes through an empty crossRulings array untouched (no ruling claimed)", async () => {
    mockGeminiResponse({ crossRulings: [] });

    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });

    expect(res.classifications[0].crossRulings).toEqual([]);
    expect(dbMock.ruling.findUnique).not.toHaveBeenCalled();
  });
});
