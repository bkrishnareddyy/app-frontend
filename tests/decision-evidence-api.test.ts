import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The evidence endpoint must only report what the tariff and rulings tables
 * hold. A code that is not loaded has to come back as not found rather than as
 * a code with no duty.
 */

const ctxMock = vi.fn();

const dbMock = {
  agentDecision: { findFirst: vi.fn() },
  htsNode: { findMany: vi.fn() },
  ruling: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: async () => true,
}));

const evidence = await import("@/app/api/decisions/[id]/evidence/route");

const ACCOUNT = "acc_1";

function call(id = "dec_1") {
  return evidence.GET(new Request(`http://localhost/api/decisions/${id}/evidence`), {
    params: Promise.resolve({ id }),
  });
}

function htsRecord(overrides: Record<string, unknown> = {}) {
  const { generalDutyRate = "Free", ...rest } = overrides as { generalDutyRate?: string };
  return {
    htsNumberNormalized: "8471300100",
    description: "Portable automatic data processing machines",
    dutyRates: [
      { rateColumn: "General", rawRateText: generalDutyRate },
      { rateColumn: "Column 2", rawRateText: "35%" },
    ],
    release: {
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      releaseName: "HTSUS 2026 Rev 1",
    },
    ...rest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ctxMock.mockResolvedValue({
    userId: "u_1",
    accountId: ACCOUNT,
    roleNames: ["ADMIN"],
    isPlatformAdmin: false,
  });
  dbMock.agentDecision.findFirst.mockResolvedValue({
    id: "dec_1",
    proposedHtsCode: "8471.30.0100",
    currentHtsCode: "8517.62.0090",
    proposedDescription: "Laptop computer",
    modelVersion: "gemini-2.0",
    rulesApplied: ["GRI 1"],
    regulations: ["19 CFR 152"],
    dataSources: ["HTSUS"],
  });
  dbMock.htsNode.findMany.mockResolvedValue([]);
  dbMock.ruling.findMany.mockResolvedValue([]);
});

describe("GET /api/decisions/[id]/evidence", () => {
  it("rejects an unauthenticated caller", async () => {
    ctxMock.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(401);
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the decision lookup to the caller's account", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(dbMock.agentDecision.findFirst.mock.calls[0][0].where).toEqual({
      id: "dec_1",
      accountId: ACCOUNT,
    });
  });

  it("looks up both codes by their digits, not their published punctuation", async () => {
    await call();

    expect(dbMock.htsNode.findMany.mock.calls[0][0].where).toEqual({
      htsNumberNormalized: { in: ["8471300100", "8517620090"] },
    });
  });

  it("reports a code that is not in the loaded tariff as not found", async () => {
    const body = await (await call()).json();

    expect(body.proposed.found).toBe(false);
    expect(body.proposed.description).toBeNull();
    expect(body.proposed.generalDutyRate).toBeNull();
    expect(body.proposed.effectiveDate).toBeNull();
  });

  it("does not claim a duty impact when a code is missing from the tariff", async () => {
    const body = await (await call()).json();

    expect(body.duty.comparable).toBe(false);
    expect(body.duty.deltaPercent).toBeNull();
  });

  it("returns the effective date and source release of a loaded code", async () => {
    dbMock.htsNode.findMany.mockResolvedValue([htsRecord()]);

    const body = await (await call()).json();

    expect(body.proposed).toMatchObject({
      found: true,
      description: "Portable automatic data processing machines",
      generalDutyRate: "Free",
      sourceRevision: "HTSUS 2026 Rev 1",
      effectiveDate: "2026-01-01T00:00:00.000Z",
    });
  });

  it("computes the general-rate difference when both codes are loaded", async () => {
    dbMock.htsNode.findMany.mockResolvedValue([
      htsRecord({ htsNumberNormalized: "8471300100", generalDutyRate: "6.5%" }),
      htsRecord({ htsNumberNormalized: "8517620090", generalDutyRate: "2.5%" }),
    ]);

    const body = await (await call()).json();

    expect(body.duty.comparable).toBe(true);
    expect(body.duty.deltaPercent).toBe(4);
  });

  it("reports no trade-remedy duty, since no such data is ingested", async () => {
    dbMock.htsNode.findMany.mockResolvedValue([htsRecord()]);

    const body = await (await call()).json();

    expect(body.proposed.additionalDuties).toEqual([]);
  });

  it("says nothing about a current code when the decision names none", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({
      id: "dec_1",
      proposedHtsCode: "8471.30.0100",
      currentHtsCode: null,
      proposedDescription: "Laptop computer",
      modelVersion: null,
      rulesApplied: [],
      regulations: [],
      dataSources: [],
    });

    const body = await (await call()).json();

    expect(body.current).toBeNull();
    expect(body.duty.comparable).toBe(false);
    expect(body.duty.reason).toMatch(/no code that the proposed code would replace/);
  });

  it("looks up rulings by both the published and the bare code", async () => {
    await call();

    expect(dbMock.ruling.findMany.mock.calls[0][0].where).toEqual({
      htsReferences: {
        some: { htsNumberDisplay: { in: ["8471.30.0100", "8471300100"] } },
      },
    });
  });

  it("returns stored rulings with their source and status", async () => {
    dbMock.ruling.findMany.mockResolvedValue([
      {
        id: "r_1",
        rulingNumber: "NY N123456",
        title: "Classification of a portable computer",
        issuedAt: new Date("2025-06-01T00:00:00.000Z"),
        rulingType: "NY",
        sourceProvider: "CBP_CROSS",
        sourceUrl: "https://rulings.cbp.gov/ruling/N123456",
        modifiedOrRevokedStatus: "EFFECTIVE",
      },
    ]);

    const body = await (await call()).json();

    expect(body.rulings).toHaveLength(1);
    expect(body.rulings[0]).toMatchObject({
      rulingNumber: "NY N123456",
      modifiedOrRevokedStatus: "EFFECTIVE",
      issuedAt: "2025-06-01T00:00:00.000Z",
    });
  });

  it("does not query the tariff at all when the decision names no code", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({
      id: "dec_1",
      proposedHtsCode: null,
      currentHtsCode: null,
      proposedDescription: null,
      modelVersion: null,
      rulesApplied: [],
      regulations: [],
      dataSources: [],
    });

    const body = await (await call()).json();

    expect(dbMock.htsNode.findMany).not.toHaveBeenCalled();
    expect(dbMock.ruling.findMany).not.toHaveBeenCalled();
    expect(body.rulings).toEqual([]);
    expect(body.duty.reason).toMatch(/neither a current nor a proposed code/);
  });
});
