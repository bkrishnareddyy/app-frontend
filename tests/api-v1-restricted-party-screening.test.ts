import { describe, it, expect, vi, beforeEach } from "vitest";

// POST /api/v1/screening/restricted-party: the partner-facing, API-key
// authenticated entry point over the deterministic Restricted/Denied-Party
// Screening engine. Covers auth/scope/rate-limit/idempotency gating and that
// a successful screen persists + audits before responding.

const authenticateApiKey = vi.fn();
const apiKeyHasScope = vi.fn();
vi.mock("@/lib/api/api-key-auth", () => ({ authenticateApiKey, apiKeyHasScope }));

const checkRestrictedPartyRate = vi.fn();
vi.mock("@/lib/api/restrictedPartyRateLimit", () => ({ checkRestrictedPartyRate }));

const checkIdempotency = vi.fn();
const persistIdempotency = vi.fn();
vi.mock("@/lib/api/idempotency", () => ({ checkIdempotency, persistIdempotency }));

const createAuditLog = vi.fn();
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, createAuditLog };
});

const runRestrictedPartyScreening = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/restrictedPartyScreening", () => ({
  runRestrictedPartyScreening,
}));

const persistScreeningRun = vi.fn();
vi.mock("@/modules/agents/compliance/restrictedParty/persistResult", () => ({
  persistScreeningRun,
}));

const { POST } = await import("@/app/api/v1/screening/restricted-party/route");

const ACCOUNT_A = "acct_A";

function apiCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return { accountId: ACCOUNT_A, keyId: "key_1", scopes: ["compliance.restrictedParty.screen"], ...overrides };
}

function postReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://x/api/v1/screening/restricted-party", {
    method: "POST",
    body: JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json", ...headers }),
  });
}

const NO_IDEMPOTENCY = { idempotencyKey: null, requestHash: null, cachedResponse: null, errorResponse: null };

beforeEach(() => {
  vi.clearAllMocks();
  authenticateApiKey.mockResolvedValue(apiCtx());
  apiKeyHasScope.mockReturnValue(true);
  checkRestrictedPartyRate.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  checkIdempotency.mockResolvedValue(NO_IDEMPOTENCY);
});

describe("POST /api/v1/screening/restricted-party: gating", () => {
  it("401s without a valid API key", async () => {
    authenticateApiKey.mockResolvedValue(null);
    const res = await POST(postReq({ party: { name: "Acme Trading Co" } }));
    expect(res.status).toBe(401);
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });

  it("403s when the key lacks compliance.restrictedParty.screen scope", async () => {
    apiKeyHasScope.mockReturnValue(false);
    const res = await POST(postReq({ party: { name: "Acme Trading Co" } }));
    expect(res.status).toBe(403);
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });

  it("429s when the rate limit has been exceeded, with a Retry-After header", async () => {
    checkRestrictedPartyRate.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await POST(postReq({ party: { name: "Acme Trading Co" } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });

  it("400s on an invalid body (missing party name)", async () => {
    const res = await POST(postReq({ party: {} }));
    expect(res.status).toBe(400);
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });

  it("returns the cached response for a duplicate Idempotency-Key without re-screening", async () => {
    const cached = new Response(JSON.stringify({ success: true, cached: true }), { status: 200 });
    checkIdempotency.mockResolvedValue({ idempotencyKey: "idem_1", requestHash: "hash_1", cachedResponse: cached, errorResponse: null });
    const res = await POST(postReq({ party: { name: "Acme Trading Co" } }, { "Idempotency-Key": "idem_1" }));
    expect(res).toBe(cached);
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });

  it("propagates an idempotency conflict response as-is", async () => {
    const conflict = new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
    checkIdempotency.mockResolvedValue({ idempotencyKey: "idem_1", requestHash: "hash_1", cachedResponse: null, errorResponse: conflict });
    const res = await POST(postReq({ party: { name: "Acme Trading Co" } }, { "Idempotency-Key": "idem_1" }));
    expect(res).toBe(conflict);
    expect(runRestrictedPartyScreening).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/screening/restricted-party: successful screen", () => {
  it("screens the ad-hoc identity under the authenticated account, persists, and audits", async () => {
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [] });
    persistScreeningRun.mockResolvedValue([
      { id: "result_1", passType: "PARTY_NAME", status: "CLEAR", hitCount: 0, redFlagCount: 0, matches: [], redFlagHits: [] },
    ]);

    const res = await POST(postReq({ party: { name: "Acme Trading Co" }, externalReference: "PO-123" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(runRestrictedPartyScreening).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_A, source: "PUBLIC_API", externalReference: "PO-123" })
    );
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ id: "result_1", status: "CLEAR" });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_A, source: "API", action: "RESTRICTED_PARTY_SCREENING_QUERIED" })
    );
  });

  it("persists the idempotency record after a successful screen when a key was supplied", async () => {
    checkIdempotency.mockResolvedValue({ idempotencyKey: "idem_1", requestHash: "hash_1", cachedResponse: null, errorResponse: null });
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [] });
    persistScreeningRun.mockResolvedValue([
      { id: "result_1", passType: "PARTY_NAME", status: "CLEAR", hitCount: 0, redFlagCount: 0, matches: [], redFlagHits: [] },
    ]);

    await POST(postReq({ party: { name: "Acme Trading Co" } }, { "Idempotency-Key": "idem_1" }));

    expect(persistIdempotency).toHaveBeenCalledWith(ACCOUNT_A, "idem_1", "hash_1", 200, expect.objectContaining({ success: true }));
  });

  it("never forwards accountId from the request body -- only from the authenticated API key context", async () => {
    runRestrictedPartyScreening.mockResolvedValue({ correlationId: "corr_1", passes: [] });
    persistScreeningRun.mockResolvedValue([]);

    await POST(postReq({ party: { name: "Acme Trading Co" }, accountId: "acct_ATTACKER" }));

    expect(runRestrictedPartyScreening).toHaveBeenCalledWith(expect.objectContaining({ accountId: ACCOUNT_A }));
  });
});
