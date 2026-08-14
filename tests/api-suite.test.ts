import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite previously declared a `MockQubereApiServer` in this same file,
// seeded it, and asserted its own seed values. It imported no route handler, so
// none of the REST contracts it claimed to cover were exercised.

const ctxMock = vi.fn();
const auditMock = vi.fn();

const dbMock = {
  shipment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  agentDecision: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  regulatoryUpdate: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({
  createAuditLog: (p: unknown) => auditMock(p),
  AuditAction: {
    DECISION_APPROVED: "DECISION_APPROVED",
    DECISION_REJECTED: "DECISION_REJECTED",
    DECISION_OVERRIDDEN: "DECISION_OVERRIDDEN",
    CLASSIFICATION_CASE_DECIDED: "CLASSIFICATION_CASE_DECIDED",
  },
}));
vi.mock("@/modules/shipments/shipmentNumber", () => ({
  generateShipmentNumber: async () => "SHP-2026-000002",
}));

const shipments = await import("@/app/api/shipments/route");
const decisions = await import("@/app/api/decisions/route");
const regulatory = await import("@/app/api/regulatory/route");

const ACCOUNT = "acc_1";

function context(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u_1",
    accountId: ACCOUNT,
    firstName: "Jane",
    lastName: "Broker",
    roleNames: ["ADMIN"],
    permissions: [
      "decisions.approve",
      "decisions.reject",
      "decisions.reevaluate",
      "decisions.override",
    ],
    ...overrides,
  };
}

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ctxMock.mockResolvedValue(context());
  dbMock.shipment.findMany.mockResolvedValue([]);
  dbMock.shipment.count.mockResolvedValue(0);
  dbMock.regulatoryUpdate.findMany.mockResolvedValue([]);
  dbMock.user.findUnique.mockResolvedValue({
    firstName: "Jane",
    lastName: "Broker",
    email: "jane@example.com",
    brokerLicenseNumber: null,
  });
});

describe("GET /api/shipments", () => {
  const listUrl = (query = "") => new Request(`http://t/api/shipments${query}`);

  it("rejects an unauthenticated caller without querying the database", async () => {
    ctxMock.mockResolvedValue(null);

    const res = await shipments.GET(listUrl());

    expect(res.status).toBe(401);
    expect(dbMock.shipment.findMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the caller's account and excludes soft-deleted rows", async () => {
    await shipments.GET(listUrl());

    expect(dbMock.shipment.findMany.mock.calls[0][0].where).toEqual({
      accountId: ACCOUNT,
      deletedAt: null,
    });
  });

  it("restricts a PLANNER to shipments assigned to them", async () => {
    ctxMock.mockResolvedValue(context({ roleNames: ["PLANNER"] }));

    await shipments.GET(listUrl());

    expect(dbMock.shipment.findMany.mock.calls[0][0].where.assignedBrokerId).toBe("u_1");
  });

  it("bounds the page even when the caller asks for no limit", async () => {
    // The list had no take at all, so its cost grew with the account.
    await shipments.GET(listUrl());

    expect(dbMock.shipment.findMany.mock.calls[0][0].take).toBe(50);
    expect(dbMock.shipment.findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("caps a page size larger than the maximum instead of honouring it", async () => {
    await shipments.GET(listUrl("?pageSize=100000"));

    expect(dbMock.shipment.findMany.mock.calls[0][0].take).toBe(100);
  });

  it("falls back to the first page when the page number is not a positive integer", async () => {
    await shipments.GET(listUrl("?page=0"));

    expect(dbMock.shipment.findMany.mock.calls[0][0].skip).toBe(0);
  });

  it("reports the count of everything matching, not of what it returned", async () => {
    // The list response now carries a computed readinessScore, so a row has to
    // carry the relations that computation reads.
    dbMock.shipment.findMany.mockResolvedValueOnce([
      { id: "s1", documents: [], lineItems: [], exceptionItems: [] },
    ]);
    dbMock.shipment.count.mockResolvedValueOnce(412);

    const body = await (await shipments.GET(listUrl())).json();

    expect(body.shipments).toHaveLength(1);
    expect(body.total).toBe(412);
    expect(dbMock.shipment.count.mock.calls[0][0].where).toEqual(
      dbMock.shipment.findMany.mock.calls[0][0].where
    );
  });

  it("searches shipment number and importer within the caller's account", async () => {
    await shipments.GET(listUrl("?q=SHP-2026"));

    const where = dbMock.shipment.findMany.mock.calls[0][0].where;
    expect(where.accountId).toBe(ACCOUNT);
    expect(where.OR).toEqual([
      { shipmentNumber: { contains: "SHP-2026", mode: "insensitive" } },
      { importerName: { contains: "SHP-2026", mode: "insensitive" } },
    ]);
  });

  it("returns only picker fields for the summary view rather than every relation", async () => {
    await shipments.GET(listUrl("?view=summary"));

    const args = dbMock.shipment.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      shipmentNumber: true,
      importerName: true,
      status: true,
    });
    expect(args.include).toBeUndefined();
  });
});

describe("POST /api/shipments", () => {
  it("rejects a payload with no importer name", async () => {
    const res = await shipments.POST(post("http://t/api/shipments", { poReference: "PO-1" }));

    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.importerName).toBeDefined();
    expect(dbMock.shipment.create).not.toHaveBeenCalled();
  });

  it("rejects an importer name that is only whitespace", async () => {
    const res = await shipments.POST(post("http://t/api/shipments", { importerName: "   " }));

    expect(res.status).toBe(400);
    expect(dbMock.shipment.create).not.toHaveBeenCalled();
  });

  it("creates a Draft shipment with a generated number and audits it", async () => {
    dbMock.shipment.create.mockResolvedValue({ id: "shp_2", shipmentNumber: "SHP-2026-000002" });

    const res = await shipments.POST(
      post("http://t/api/shipments", { importerName: "Global Logistics", poReference: "PO-990011" })
    );

    expect(res.status).toBe(201);
    const data = dbMock.shipment.create.mock.calls[0][0].data;
    expect(data.accountId).toBe(ACCOUNT);
    expect(data.shipmentNumber).toBe("SHP-2026-000002");
    expect(data.status).toBe("Draft");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "shipment.create" }));
  });

  it("does not let the caller choose the account the shipment lands in", async () => {
    dbMock.shipment.create.mockResolvedValue({ id: "shp_2" });

    await shipments.POST(
      post("http://t/api/shipments", { importerName: "Acme", accountId: "acc_someone_else" })
    );

    expect(dbMock.shipment.create.mock.calls[0][0].data.accountId).toBe(ACCOUNT);
  });
});

describe("POST /api/decisions", () => {
  const decision = {
    id: "dec_1",
    accountId: ACCOUNT,
    humanNotes: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("rejects an unrecognised action without touching the record", async () => {
    // This used to fall through to "In Progress", write the update, then throw
    // on action.toLowerCase() — so the decision changed and nothing was audited.
    dbMock.agentDecision.findFirst.mockResolvedValue(decision);

    const res = await decisions.POST(
      post("http://t/api/decisions", { decisionId: "dec_1", action: "ESCALATE" })
    );

    expect(res.status).toBe(400);
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no action at all", async () => {
    const res = await decisions.POST(post("http://t/api/decisions", { decisionId: "dec_1" }));

    expect(res.status).toBe(400);
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a missing decisionId instead of matching an arbitrary decision", async () => {
    // Prisma drops undefined filters, so `where: { id: undefined }` would have
    // matched the first decision in the account.
    const res = await decisions.POST(post("http://t/api/decisions", { action: "APPROVE" }));

    expect(res.status).toBe(400);
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
  });

  it("approves a decision and records the reviewer", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decision);
    dbMock.agentDecision.updateMany.mockResolvedValue({ count: 1 });

    const res = await decisions.POST(
      post("http://t/api/decisions", {
        decisionId: "dec_1",
        action: "APPROVE",
        humanNotes: "Verified voltage specs",
      })
    );

    expect(res.status).toBe(200);
    const data = dbMock.agentDecision.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("Approved");
    expect(data.humanNotes).toBe("Verified voltage specs");
    expect(data.reviewedByUserId).toBe("u_1");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "DECISION_APPROVED" }));
  });

  it("claims the row on the revision the reviewer read", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decision);
    dbMock.agentDecision.updateMany.mockResolvedValue({ count: 1 });

    await decisions.POST(
      post("http://t/api/decisions", {
        decisionId: "dec_1",
        action: "APPROVE",
        expectedVersion: "2026-01-01T00:00:00.000Z",
      })
    );

    const where = dbMock.agentDecision.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe("dec_1");
    expect(where.accountId).toBe(ACCOUNT);
    expect(where.updatedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("refuses a decision that changed since it was opened", async () => {
    // Both reviewers used to win; the second silently overwrote the first.
    dbMock.agentDecision.findFirst.mockResolvedValue(decision);
    dbMock.agentDecision.updateMany.mockResolvedValue({ count: 0 });

    const res = await decisions.POST(
      post("http://t/api/decisions", {
        decisionId: "dec_1",
        action: "APPROVE",
        expectedVersion: "2025-06-01T00:00:00.000Z",
      })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STALE_DECISION");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("requires a reason to reject", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decision);

    const res = await decisions.POST(
      post("http://t/api/decisions", { decisionId: "dec_1", action: "REJECT", humanNotes: "   " })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("RATIONALE_REQUIRED");
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });

  it("maps RE_EVALUATE back to In Progress", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(decision);
    dbMock.agentDecision.updateMany.mockResolvedValue({ count: 1 });

    await decisions.POST(post("http://t/api/decisions", { decisionId: "dec_1", action: "RE_EVALUATE" }));

    expect(dbMock.agentDecision.updateMany.mock.calls[0][0].data.status).toBe("In Progress");
  });

  it("does not act on another account's decision", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue(null);

    const res = await decisions.POST(
      post("http://t/api/decisions", { decisionId: "dec_other", action: "APPROVE" })
    );

    expect(res.status).toBe(404);
    expect(dbMock.agentDecision.findFirst.mock.calls[0][0].where.accountId).toBe(ACCOUNT);
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/decisions", () => {
  it("scopes the list to the caller's account", async () => {
    dbMock.agentDecision.findMany.mockResolvedValue([]);

    await decisions.GET(new Request("http://localhost/api/decisions"));

    expect(dbMock.agentDecision.findMany.mock.calls[0][0].where).toEqual({ accountId: ACCOUNT });
  });
});

describe("GET /api/regulatory", () => {
  const regulatoryReq = () => new Request("http://localhost/api/regulatory");

  it("requires authentication", async () => {
    ctxMock.mockResolvedValue(null);

    const res = await regulatory.GET(regulatoryReq());

    expect(res.status).toBe(401);
    expect(dbMock.regulatoryUpdate.findMany).not.toHaveBeenCalled();
  });

  it("returns the stored updates without inventing any", async () => {
    const res = await regulatory.GET(regulatoryReq());

    expect(res.status).toBe(200);
    expect((await res.json()).updates).toEqual([]);
  });
});
