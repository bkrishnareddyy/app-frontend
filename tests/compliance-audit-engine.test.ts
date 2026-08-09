import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite previously declared a `ComplianceAuditMockService` in this same file
// holding hardcoded findings, supplier scores and broker metrics, then asserted
// those literals. No route handler was imported, so nothing here was covered.

const ctxMock = vi.fn();
const auditMock = vi.fn();

const dbMock = {
  complianceFinding: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn(), createMany: vi.fn() },
  customsFiling: { findFirst: vi.fn() },
  supplierRiskScore: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn() },
  brokerMetrics: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn() },
  tradeBenchmark: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), createMany: vi.fn() },
  auditTimeline: { findMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ createAuditLog: (p: unknown) => auditMock(p) }));

const findings = await import("@/app/api/findings/route");
const resolve = await import("@/app/api/findings/[id]/resolve/route");
const suppliers = await import("@/app/api/risk/suppliers/route");
const brokers = await import("@/app/api/risk/brokers/route");
const benchmarks = await import("@/app/api/trade-intel/benchmarks/route");

const ACCOUNT = "acc_1";

function get(url: string) {
  return new Request(url);
}

function post(body: unknown) {
  return new Request("http://t/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "find_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
    ctxMock.mockResolvedValue({
      userId: "u_1",
      accountId: ACCOUNT,
      roleNames: ["ADMIN"],
      permissions: [],
      isPlatformAdmin: false,
    });
  dbMock.complianceFinding.findMany.mockResolvedValue([]);
  dbMock.supplierRiskScore.findMany.mockResolvedValue([]);
  dbMock.brokerMetrics.findMany.mockResolvedValue([]);
  dbMock.tradeBenchmark.findMany.mockResolvedValue([]);
});

describe("GET /api/findings", () => {
  it("returns an empty list rather than inventing findings against a real filing", async () => {
    // This route used to attach a 24% valuation variance and an undeclared tooling
    // assist to the account's first customs filing, then return them as detections.
    const res = await findings.GET(get("http://t/api/findings"));

    expect(res.status).toBe(200);
    expect((await res.json()).findings).toEqual([]);
    expect(dbMock.complianceFinding.createMany).not.toHaveBeenCalled();
    expect(dbMock.customsFiling.findFirst).not.toHaveBeenCalled();
  });

  it("scopes findings to the caller's account", async () => {
    await findings.GET(get("http://t/api/findings"));

    expect(dbMock.complianceFinding.findMany.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
  });

  it("applies status and severity filters", async () => {
    await findings.GET(get("http://t/api/findings?status=Open&severity=High"));

    const where = dbMock.complianceFinding.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ equals: "Open", mode: "insensitive" });
    expect(where.severity).toEqual({ equals: "High", mode: "insensitive" });
  });

  it("treats status=all as no status filter", async () => {
    await findings.GET(get("http://t/api/findings?status=all"));

    expect(dbMock.complianceFinding.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });
});

describe("POST /api/findings/[id]/resolve", () => {
  const finding = { id: "find_1", accountId: ACCOUNT, filingId: "fil_1", rule: "Valuation Variance", status: "Open" };

  it("rejects an empty body instead of defaulting to Resolved", async () => {
    const res = await resolve.POST(post({}), params);

    expect(res.status).toBe(400);
    expect(dbMock.complianceFinding.update).not.toHaveBeenCalled();
  });

  it("rejects a status outside the documented lifecycle", async () => {
    const res = await resolve.POST(post({ status: "Ignored" }), params);

    expect(res.status).toBe(400);
    expect(dbMock.complianceFinding.update).not.toHaveBeenCalled();
  });

  it("stamps resolvedAt when a finding is resolved", async () => {
    dbMock.complianceFinding.findFirst.mockResolvedValue(finding);
    dbMock.complianceFinding.update.mockResolvedValue({ ...finding, status: "Resolved" });

    const res = await resolve.POST(post({ status: "Resolved" }), params);

    expect(res.status).toBe(200);
    expect(dbMock.complianceFinding.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "finding.resolve" }));
  });

  it("does not record a resolution in the audit trail for a move to Investigating", async () => {
    // The timeline event was hardcoded to "Compliance Finding Resolved" for every status.
    dbMock.complianceFinding.findFirst.mockResolvedValue(finding);
    dbMock.complianceFinding.update.mockResolvedValue({ ...finding, status: "Investigating" });

    await resolve.POST(post({ status: "Investigating" }), params);

    const event = dbMock.auditTimeline.create.mock.calls[0][0].data.event;
    expect(event).not.toContain("Resolved");
    expect(event).toContain("Investigating");
    expect(dbMock.complianceFinding.update.mock.calls[0][0].data.resolvedAt).toBeNull();
  });

  it("does not resolve another account's finding", async () => {
    dbMock.complianceFinding.findFirst.mockResolvedValue(null);

    const res = await resolve.POST(post({ status: "Resolved" }), params);

    expect(res.status).toBe(404);
    expect(dbMock.complianceFinding.findFirst.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
    expect(dbMock.auditTimeline.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/risk/suppliers", () => {
  const suppliersReq = () => new Request("http://localhost/api/risk/suppliers");

  it("does not seed invented suppliers into the tenant's database", async () => {
    const res = await suppliers.GET(suppliersReq());

    expect(res.status).toBe(200);
    expect((await res.json()).supplierRisks).toEqual([]);
    expect(dbMock.supplierRiskScore.createMany).not.toHaveBeenCalled();
  });

  it("scopes supplier scores to the caller's account", async () => {
    await suppliers.GET(suppliersReq());

    expect(dbMock.supplierRiskScore.findMany.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
  });

  it("requires authentication", async () => {
    ctxMock.mockResolvedValue(null);

    expect((await suppliers.GET(suppliersReq())).status).toBe(401);
  });
});

describe("GET /api/risk/brokers", () => {
  const brokersReq = () => new Request("http://localhost/api/risk/brokers");

  it("does not seed invented broker accuracy figures", async () => {
    const res = await brokers.GET(brokersReq());

    expect(res.status).toBe(200);
    expect((await res.json()).brokerMetrics).toEqual([]);
    expect(dbMock.brokerMetrics.createMany).not.toHaveBeenCalled();
  });

  it("scopes broker metrics to the caller's account", async () => {
    await brokers.GET(brokersReq());

    expect(dbMock.brokerMetrics.findMany.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
  });
});

describe("GET /api/trade-intel/benchmarks", () => {
  it("does not publish invented industry averages into the shared table", async () => {
    // TradeBenchmark has no accountId, so the old seeding on first read exposed
    // fabricated US import volumes to every tenant.
    const res = await benchmarks.GET(get("http://t/api/trade-intel/benchmarks"));

    expect(res.status).toBe(200);
    expect(dbMock.tradeBenchmark.createMany).not.toHaveBeenCalled();
  });

  it("returns null for an HTS code with no benchmark rather than a placeholder", async () => {
    dbMock.tradeBenchmark.findFirst.mockResolvedValue(null);

    const res = await benchmarks.GET(get("http://t/api/trade-intel/benchmarks?htsCode=8481.80.5090"));

    expect((await res.json()).benchmark).toBeNull();
  });
});
