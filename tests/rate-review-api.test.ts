import { describe, it, expect, vi, beforeEach } from "vitest";

// Trade-rate review queue: Section301Rate / Section301Exclusion / AdCvdCompanyRate
// rows start reviewStatus="PENDING" and must never affect a duty calculation
// until a platform admin approves them here. These tests cover the gate:
// platform-admin only, valid type only, and no double-review of a row that
// already moved off PENDING.

const ctxMock = vi.fn();

const dbMock = {
  section301Rate: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  section301Exclusion: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  adCvdCompanyRate: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn(),
  AuditAction: { TRADE_RATE_APPROVED: "TRADE_RATE_APPROVED", TRADE_RATE_REJECTED: "TRADE_RATE_REJECTED" },
}));

const listRoute = await import("@/app/api/platform-admin/rate-review/route");
const reviewRoute = await import("@/app/api/platform-admin/rate-review/[type]/[id]/route");

function get() {
  return listRoute.GET(new Request("http://localhost/api/platform-admin/rate-review"));
}

function post(type: string, id: string, body: unknown) {
  return reviewRoute.POST(
    new Request(`http://localhost/api/platform-admin/rate-review/${type}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ type, id }) }
  );
}

const PLATFORM_ADMIN_CTX = {
  userId: "u_1",
  accountId: "acc_platform",
  roleNames: ["ADMIN"],
  permissions: [],
  isPlatformAdmin: true,
};

const PENDING_RATE = {
  id: "rate_1",
  htsNumber: "8481.80.9020",
  tranche: "LIST_3",
  dutyRatePct: 25,
  federalRegisterCitation: "91 Fed. Reg. 41000",
  reviewStatus: "PENDING",
  createdAt: new Date("2026-08-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  ctxMock.mockResolvedValue(PLATFORM_ADMIN_CTX);
  dbMock.section301Rate.findMany.mockResolvedValue([PENDING_RATE]);
  dbMock.section301Exclusion.findMany.mockResolvedValue([]);
  dbMock.adCvdCompanyRate.findMany.mockResolvedValue([]);
  dbMock.section301Rate.findUnique.mockResolvedValue(PENDING_RATE);
  dbMock.section301Rate.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...PENDING_RATE,
    ...data,
  }));
});

describe("GET /api/platform-admin/rate-review", () => {
  it("rejects an unauthenticated caller", async () => {
    ctxMock.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("rejects a caller who is not a platform admin", async () => {
    ctxMock.mockResolvedValue({ ...PLATFORM_ADMIN_CTX, isPlatformAdmin: false });
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("returns pending items with a per-type summary", async () => {
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.total).toBe(1);
    expect(body.summary.byType.SECTION_301_RATE).toBe(1);
    expect(body.items[0].type).toBe("SECTION_301_RATE");
    expect(body.items[0].headline).toContain("8481.80.9020");
  });
});

describe("POST /api/platform-admin/rate-review/[type]/[id]", () => {
  it("rejects an unknown type", async () => {
    const res = await post("NOT_A_TYPE", "rate_1", { action: "APPROVE" });
    expect(res.status).toBe(400);
    expect(dbMock.section301Rate.update).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not a platform admin", async () => {
    ctxMock.mockResolvedValue({ ...PLATFORM_ADMIN_CTX, isPlatformAdmin: false });
    const res = await post("SECTION_301_RATE", "rate_1", { action: "APPROVE" });
    expect(res.status).toBe(403);
    expect(dbMock.section301Rate.update).not.toHaveBeenCalled();
  });

  it("404s when the row does not exist", async () => {
    dbMock.section301Rate.findUnique.mockResolvedValue(null);
    const res = await post("SECTION_301_RATE", "missing", { action: "APPROVE" });
    expect(res.status).toBe(404);
  });

  it("409s when the row is no longer PENDING", async () => {
    dbMock.section301Rate.findUnique.mockResolvedValue({ ...PENDING_RATE, reviewStatus: "APPROVED" });
    const res = await post("SECTION_301_RATE", "rate_1", { action: "APPROVE" });
    expect(res.status).toBe(409);
    expect(dbMock.section301Rate.update).not.toHaveBeenCalled();
  });

  it("approves a pending rate", async () => {
    const res = await post("SECTION_301_RATE", "rate_1", { action: "APPROVE" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item.reviewStatus).toBe("APPROVED");
    expect(dbMock.section301Rate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rate_1" }, data: expect.objectContaining({ reviewStatus: "APPROVED" }) })
    );
  });

  it("rejects a pending rate", async () => {
    const res = await post("SECTION_301_RATE", "rate_1", { action: "REJECT" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item.reviewStatus).toBe("REJECTED");
  });

  it("rejects a malformed action", async () => {
    const res = await post("SECTION_301_RATE", "rate_1", { action: "MAYBE" });
    expect(res.status).toBe(400);
  });
});
