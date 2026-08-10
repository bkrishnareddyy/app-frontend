import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers the permission gate and reviewer attribution on POST /api/decisions.
// Before this, any role that was not VIEWER could approve a reclassification,
// and nothing on the record said whether the approver held a broker license.

const dbMock = {
  agentDecision: { findFirst: vi.fn(), updateMany: vi.fn() },
  shipmentLineItem: { findMany: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
};

const getAccountContext = vi.fn();
const createAuditLog = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getAccountContext }));
vi.mock("@/lib/audit", () => ({ createAuditLog }));

const { POST } = await import("@/app/api/decisions/route");

const OVERRIDE_DECISION = {
  id: "dec_1",
  accountId: "acc_1",
  shipmentId: "shp_1",
  confidence: 88,
  currentHtsCode: "8481.80.5090",
  proposedHtsCode: "8537.10.2030",
  humanNotes: null,
  reviewedByUserId: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function post(body: Record<string, unknown>) {
  return POST(new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }));
}

function ctx(permissions: string[], overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acc_1",
    userId: "u_1",
    roleNames: ["MEMBER"],
    isPlatformAdmin: false,
    permissions,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccountContext.mockResolvedValue(ctx(["decisions.approve", "decisions.override"]));
  dbMock.agentDecision.findFirst.mockResolvedValue({ ...OVERRIDE_DECISION });
  dbMock.agentDecision.updateMany.mockResolvedValue({ count: 1 });
  dbMock.shipmentLineItem.findMany.mockResolvedValue([]);
  dbMock.user.findUnique.mockResolvedValue({
    firstName: "Sam",
    lastName: "Operator",
    email: "sam@example.com",
    brokerLicenseNumber: null,
  });
});

describe("POST /api/decisions — permission to review", () => {
  it("refuses a writer who holds no approval permission", async () => {
    getAccountContext.mockResolvedValue(ctx([]));

    const res = await post({ decisionId: "dec_1", action: "APPROVE" });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("PERMISSION_REQUIRED");
    expect(body.missing).toEqual(["decisions.approve"]);
  });

  it("does not read the decision when the base permission is missing", async () => {
    getAccountContext.mockResolvedValue(ctx([]));

    await post({ decisionId: "dec_1", action: "APPROVE" });

    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });

  it("records the refusal as a failed audit entry", async () => {
    getAccountContext.mockResolvedValue(ctx([]));

    await post({ decisionId: "dec_1", action: "APPROVE" });

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "decision.approve",
        entity: "AgentDecision",
        entityId: "dec_1",
        success: false,
        metadata: { reason: "PERMISSION_REQUIRED", missing: ["decisions.approve"] },
      })
    );
  });

  it("gates rejection on its own permission", async () => {
    getAccountContext.mockResolvedValue(ctx(["decisions.approve"]));

    const res = await post({ decisionId: "dec_1", action: "REJECT", humanNotes: "Wrong code." });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.missing).toEqual(["decisions.reject"]);
  });

  it("stops an approver without the override permission from replacing a filed code", async () => {
    getAccountContext.mockResolvedValue(ctx(["decisions.approve"]));

    const res = await post({ decisionId: "dec_1", action: "APPROVE" });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.missing).toEqual(["decisions.override"]);
    // The row must not be claimed, or the reviewer loses the decision to a 403.
    expect(dbMock.agentDecision.updateMany).not.toHaveBeenCalled();
  });

  it("lets the same approver accept a first classification", async () => {
    getAccountContext.mockResolvedValue(ctx(["decisions.approve"]));
    dbMock.agentDecision.findFirst.mockResolvedValue({
      ...OVERRIDE_DECISION,
      currentHtsCode: null,
    });

    const res = await post({ decisionId: "dec_1", action: "APPROVE" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.overridesClassification).toBe(false);
  });

  it("lets an OWNER through without an explicit grant", async () => {
    getAccountContext.mockResolvedValue(ctx([], { roleNames: ["OWNER"] }));

    const res = await post({ decisionId: "dec_1", action: "APPROVE" });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/decisions — reviewer capacity", () => {
  it("records a broker sign-off with the license number in the audit log", async () => {
    dbMock.user.findUnique.mockResolvedValue({
      firstName: "Jane",
      lastName: "Broker",
      email: "jane@example.com",
      brokerLicenseNumber: "CHB-24815",
    });

    const res = await post({ decisionId: "dec_1", action: "APPROVE" });
    const body = await res.json();

    expect(body.reviewedAs).toEqual({
      capacity: "LICENSED_BROKER",
      licenseNumber: "CHB-24815",
      name: "Jane Broker",
    });
    expect(res.status).toBe(200);

    const audit = createAuditLog.mock.calls.at(-1)![0];
    expect(audit.metadata).toMatchObject({
      reviewerCapacity: "LICENSED_BROKER",
      brokerLicenseNumber: "CHB-24815",
      overridesClassification: true,
    });
  });

  it("does not claim broker capacity for a reviewer with no license on file", async () => {
    const res = await post({ decisionId: "dec_1", action: "APPROVE" });
    const body = await res.json();

    expect(body.reviewedAs.capacity).toBe("OPERATOR");
    expect(body.reviewedAs.licenseNumber).toBeNull();
  });

  it("looks the license up on the user row rather than trusting the session", async () => {
    await post({ decisionId: "dec_1", action: "APPROVE" });

    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u_1" },
      select: { firstName: true, lastName: true, email: true, brokerLicenseNumber: true },
    });
  });

  it("returns provenance describing who closed the decision", async () => {
    dbMock.agentDecision.findFirst
      .mockResolvedValueOnce({ ...OVERRIDE_DECISION })
      .mockResolvedValueOnce({
        ...OVERRIDE_DECISION,
        status: "Approved",
        reviewedByUserId: "u_1",
        reviewedByUser: {
          firstName: "Jane",
          lastName: "Broker",
          email: "jane@example.com",
          brokerLicenseNumber: "CHB-24815",
        },
      });

    const res = await post({ decisionId: "dec_1", action: "APPROVE" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.provenance).toMatchObject({
      kind: "LICENSED_BROKER_REVIEW",
      licenseNumber: "CHB-24815",
    });
  });
});
