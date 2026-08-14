import { describe, it, expect, vi, beforeEach } from "vitest";

// /api/v1/compliance/embargo-screening: the partner-facing, API-key-authenticated
// read/explain layer over the deterministic Country Embargo Screening engine's
// persisted evidence. It must never determine embargo status itself, and it
// shares screeningQuery.ts with the chat assistant tools so both surfaces agree
// on status presentation, audit/finding-count separation, and tenant isolation.

const dbMock = {
  accountApiKey: { findFirst: vi.fn(), update: vi.fn() },
  shipment: { findFirst: vi.fn() },
  agentDecision: { findFirst: vi.fn() },
};
const processEvent = vi.fn();
const createAuditLog = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/agents/pipelineOrchestrator", () => ({
  PipelineOrchestrator: { processEvent },
}));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, createAuditLog };
});

const { GET, POST } = await import("@/app/api/v1/compliance/embargo-screening/route");

const ACCOUNT_A = "acct_A";
const RAW_KEY = "sk_live_testkey1234567890";

function apiKeyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "key_1",
    accountId: ACCOUNT_A,
    keyPrefix: RAW_KEY.slice(0, 8),
    keyHash: expect.any(String), // unused directly; findFirst is mocked to always match
    status: "ACTIVE",
    scopes: ["embargo.read", "embargo.screen"],
    expiresAt: null,
    ...overrides,
  };
}

function req(url: string, init: RequestInit = {}, key: string | null = RAW_KEY) {
  const headers = new Headers(init.headers);
  if (key) headers.set("Authorization", `Bearer ${key}`);
  return new Request(url, { ...init, headers });
}

function decisionWith(screening: Record<string, unknown>, createdAt = new Date("2026-08-01T00:00:00Z")) {
  return {
    id: "dec_1",
    createdAt,
    evidenceItems: { countryEmbargoScreening: screening },
  };
}

const CLEAR_SCREENING = {
  status: "CLEAR",
  hits: [],
  checks: [
    {
      result: "CLEAR",
      complianceCountry: "US",
      screenedCountry: "DE",
      screeningLevel: "TRANSACTION",
      type: "D",
      matcher: "STANDARD",
      reason: "DIRECT_COUNTRY_PAIR_CLEAR",
      context: {},
    },
  ],
  skippedChecks: [],
  errors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.accountApiKey.findFirst.mockResolvedValue(apiKeyRow());
  dbMock.accountApiKey.update.mockResolvedValue({});
  dbMock.shipment.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.accountId !== ACCOUNT_A) return null;
    if (where.OR.some((c: any) => c.id === "ship_1" || c.shipmentNumber === "SHP-1001")) {
      return { id: "ship_1", shipmentNumber: "SHP-1001" };
    }
    return null;
  });
});

describe("GET /api/v1/compliance/embargo-screening", () => {
  it("401s without an API key", async () => {
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1", {}, null));
    expect(res.status).toBe(401);
  });

  it("403s when the key lacks embargo.read scope", async () => {
    dbMock.accountApiKey.findFirst.mockResolvedValue(apiKeyRow({ scopes: ["shipments.read"] }));
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1"));
    expect(res.status).toBe(403);
  });

  it("400s when shipmentId is missing", async () => {
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening"));
    expect(res.status).toBe(400);
  });

  it("404s for a shipment not owned by the key's account, even with a valid-looking id", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=SHP-OWNED-BY-B"));
    expect(res.status).toBe(404);
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
  });

  it("never triggers a rescreen -- pure read over persisted evidence", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));
    await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1"));
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("returns the presented status, audit summary, and finding count distinctly", async () => {
    const HIT_SCREENING = {
      status: "HIT",
      hits: [{ screeningLevel: "LINE", type: "D", complianceCountry: "US", country: "IR", matcher: "STANDARD", reason: "DIRECT_COUNTRY_PAIR_EMBARGOED", lineItemId: "li_1" }],
      checks: [
        { result: "CLEAR", complianceCountry: "US", screenedCountry: "DE", screeningLevel: "TRANSACTION", type: "D", matcher: "STANDARD", context: {} },
        { result: "HIT", complianceCountry: "US", screenedCountry: "IR", screeningLevel: "LINE", type: "D", matcher: "STANDARD", context: { lineItemId: "li_1" } },
      ],
      skippedChecks: [],
      errors: [],
    };
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(HIT_SCREENING));
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("HIT");
    expect(body.auditSummary).toEqual({ totalChecksPerformed: 2, passed: 1, failed: 1, skipped: 0, errored: 0 });
    expect(body.findingCount).toBe(1);
  });

  it("filters matching checks by direction (D/O) via query params", async () => {
    const screening = {
      ...CLEAR_SCREENING,
      checks: [
        ...CLEAR_SCREENING.checks,
        { result: "CLEAR", complianceCountry: "US", screenedCountry: "CN", screeningLevel: "LINE", type: "O", matcher: "STANDARD", context: { lineItemId: "li_1" } },
      ],
    };
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(screening));
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1&type=O"));
    const body = await res.json();
    expect(body.matchingChecks).toHaveLength(1);
    expect(body.matchingChecks[0].screenedCountry).toBe("CN");
  });

  it("downgrades a CLEAR engine status to PARTIAL when checks were skipped, disclosing the skip", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(
      decisionWith({ ...CLEAR_SCREENING, skippedChecks: [{ reason: "MISSING_PARTY_COUNTRY", screeningLevel: "PARTY", partyId: "le_9" }] })
    );
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1"));
    const body = await res.json();
    expect(body.engineStatus).toBe("CLEAR");
    expect(body.status).toBe("PARTIAL");
  });

  it("reports screeningPerformed: false rather than fabricating a result when nothing has run yet", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(null);
    const res = await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.screeningPerformed).toBe(false);
  });

  it("writes an EMBARGO_SCREENING_QUERIED audit log tagged with source: API", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));
    await GET(req("https://x/api/v1/compliance/embargo-screening?shipmentId=ship_1"));
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_A, userId: null, source: "API", entityId: "ship_1" })
    );
  });
});

describe("POST /api/v1/compliance/embargo-screening", () => {
  function postReq(body: unknown, key: string | null = RAW_KEY) {
    return req("https://x/api/v1/compliance/embargo-screening", { method: "POST", body: JSON.stringify(body) }, key);
  }

  it("401s without an API key", async () => {
    const res = await POST(postReq({ shipmentId: "ship_1" }, null));
    expect(res.status).toBe(401);
  });

  it("reuses the existing result without rescreening when forceRescreen is omitted", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));
    const res = await POST(postReq({ shipmentId: "ship_1" }));
    const body = await res.json();
    expect(body.status).toBe("CLEAR");
    expect(body.rescreened).toBe(false);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("triggers a fresh Compliance Audit Agent run when forceRescreen is true and the key holds embargo.screen", async () => {
    dbMock.agentDecision.findFirst
      .mockResolvedValueOnce(decisionWith(CLEAR_SCREENING, new Date("2026-08-01T00:00:00Z")))
      .mockResolvedValueOnce(decisionWith({ ...CLEAR_SCREENING, status: "HIT" }, new Date("2026-08-14T00:00:00Z")));
    processEvent.mockResolvedValue({});

    const res = await POST(postReq({ shipmentId: "ship_1", forceRescreen: true }));
    const body = await res.json();

    expect(processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "ship_1", accountId: ACCOUNT_A, triggerEvent: "RECONCILIATION_REQUESTED" })
    );
    expect(body.rescreened).toBe(true);
    expect(body.status).toBe("HIT");
  });

  it("denies an explicit rescreen request when the key lacks embargo.screen, and says so rather than silently reusing", async () => {
    dbMock.accountApiKey.findFirst.mockResolvedValue(apiKeyRow({ scopes: ["embargo.read"] }));
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));

    const res = await POST(postReq({ shipmentId: "ship_1", forceRescreen: true }));
    const body = await res.json();

    expect(processEvent).not.toHaveBeenCalled();
    expect(body.rescreened).toBe(false);
    expect(body.rescreenDenied).toBe(true);
  });

  it("reports NOT_SCREENED, never a fabricated CLEAR, when nothing has been screened and the key cannot trigger a run", async () => {
    dbMock.accountApiKey.findFirst.mockResolvedValue(apiKeyRow({ scopes: ["embargo.read"] }));
    dbMock.agentDecision.findFirst.mockResolvedValue(null);

    const res = await POST(postReq({ shipmentId: "ship_1" }));
    const body = await res.json();

    expect(body.status).toBe("NOT_SCREENED");
    expect(body.screeningPerformed).toBe(false);
  });

  it("never lets one account's key rescreen or read another account's shipment", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);
    const res = await POST(postReq({ shipmentId: "SHP-OWNED-BY-B" }));
    expect(res.status).toBe(404);
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("writes an EMBARGO_SCREENING_RESCREENED audit log only when a rescreen actually runs", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decisionWith(CLEAR_SCREENING));
    await POST(postReq({ shipmentId: "ship_1" })); // no forceRescreen -> no rescreen
    expect(createAuditLog).not.toHaveBeenCalled();

    processEvent.mockResolvedValue({});
    dbMock.agentDecision.findFirst
      .mockResolvedValueOnce(decisionWith(CLEAR_SCREENING))
      .mockResolvedValueOnce(decisionWith(CLEAR_SCREENING));
    await POST(postReq({ shipmentId: "ship_1", forceRescreen: true }));
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_A, source: "API", entityId: "ship_1" })
    );
  });
});
