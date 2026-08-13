import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
  agentDecision: { findMany: vi.fn(), updateMany: vi.fn() },
  shipmentLineItem: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  shipment: { update: vi.fn() },
  user: { findUnique: vi.fn() },
};

const getAccountContext = vi.fn();
const hasPermission = vi.fn();
const createAuditLog = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getAccountContext, hasPermission }));
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    createAuditLog,
  };
});
vi.mock("@/modules/shipment/reconciliationEngine", () => ({
  ReconciliationEngine: { reconcileShipment: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@/modules/audit/factAuditService", () => ({
  FactAuditService: { logChangeEvent: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@/modules/shipment/factService", () => ({
  FactService: { record: vi.fn().mockResolvedValue({}) },
}));

const { POST } = await import("@/app/api/decisions/bulk/route");

function postBulk(body: Record<string, unknown>) {
  return POST(new Request("http://t/api/decisions/bulk", { method: "POST", body: JSON.stringify(body) }));
}

function ctx() {
  return {
    accountId: "acc_1",
    userId: "u_1",
    roleNames: ["MEMBER"],
    isPlatformAdmin: false,
    permissions: ["decisions.approve", "decisions.reject", "decisions.override"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockResolvedValue(true);
  getAccountContext.mockResolvedValue(ctx());
  dbMock.user.findUnique.mockResolvedValue({
    firstName: "Sam",
    lastName: "Operator",
    email: "sam@example.com",
    brokerLicenseNumber: null,
  });
  dbMock.agentDecision.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/decisions/bulk — idempotency check", () => {
  it("skips already-approved decisions with status 'Approved'", async () => {
    dbMock.agentDecision.findMany.mockResolvedValue([
      {
        id: "dec_1",
        accountId: "acc_1",
        shipmentId: "shp_1",
        status: "Approved",
        triageState: "APPROVED",
        currentHtsCode: null,
        proposedHtsCode: "8481.80.5090",
        lineNumber: 1,
        confidence: 90,
        updatedAt: new Date("2026-01-01"),
      },
    ]);

    const res = await postBulk({ decisionIds: ["dec_1"], action: "APPROVE" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.results).toEqual([
      { id: "dec_1", status: "skipped", reason: "already_terminal" },
    ]);
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });

  it("skips already-rejected decisions with status 'Rejected'", async () => {
    dbMock.agentDecision.findMany.mockResolvedValue([
      {
        id: "dec_2",
        accountId: "acc_1",
        shipmentId: "shp_1",
        status: "Rejected",
        triageState: "REJECTED",
        currentHtsCode: null,
        proposedHtsCode: "8481.80.5090",
        lineNumber: 1,
        confidence: 90,
        updatedAt: new Date("2026-01-01"),
      },
    ]);

    const res = await postBulk({ decisionIds: ["dec_2"], action: "REJECT", humanNotes: "Wrong code" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.results).toEqual([
      { id: "dec_2", status: "skipped", reason: "already_terminal" },
    ]);
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });

  it("processes unreviewed decision with status 'Needs Review'", async () => {
    dbMock.agentDecision.findMany.mockResolvedValue([
      {
        id: "dec_3",
        accountId: "acc_1",
        shipmentId: "shp_1",
        status: "Needs Review",
        triageState: "NEEDS_REVIEW",
        currentHtsCode: null,
        proposedHtsCode: "8481.80.5090",
        lineNumber: 1,
        confidence: 90,
        updatedAt: new Date("2026-01-01"),
      },
    ]);

    const res = await postBulk({ decisionIds: ["dec_3"], action: "APPROVE" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.results).toEqual([{ id: "dec_3", status: "ok" }]);
    expect(dbMock.agentDecision.updateMany).toHaveBeenCalledTimes(1);
  });
});
