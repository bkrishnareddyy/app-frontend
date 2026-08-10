import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers POST /api/decisions. Approving a reclassification used to change only
// the AgentDecision row, leaving the line items on the rejected HTS code.

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

const DECISION = {
  id: "dec_1",
  accountId: "acc_1",
  shipmentId: "shp_1",
  confidence: 88,
  currentHtsCode: "8481.80.5090",
  proposedHtsCode: "8537.10.2030",
  humanNotes: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function post(body: Record<string, unknown>) {
  return POST(new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }));
}

function approve() {
  return post({ decisionId: "dec_1", action: "APPROVE", humanNotes: "Agreed." });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccountContext.mockResolvedValue({
    accountId: "acc_1",
    userId: "u_1",
    roleNames: ["MEMBER"],
    isPlatformAdmin: false,
    permissions: ["decisions.approve", "decisions.reject", "decisions.override"],
  });
  dbMock.user.findUnique.mockResolvedValue({
    firstName: "Sam",
    lastName: "Operator",
    email: "sam@example.com",
    brokerLicenseNumber: null,
  });
  dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION });
  dbMock.agentDecision.updateMany.mockResolvedValue({ count: 1 });
  dbMock.shipmentLineItem.findMany.mockResolvedValue([{ id: "li_1" }, { id: "li_2" }]);
  dbMock.shipmentLineItem.updateMany.mockResolvedValue({ count: 2 });
});

describe("POST /api/decisions — applying an approved classification", () => {
  it("moves every line still carrying the code the decision replaces", async () => {
    const res = await approve();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.shipmentLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["li_1", "li_2"] } },
      data: { htsCode: "8537.10.2030", htsConfidence: 88 },
    });
    expect(body.classificationApplied.updatedLineItemIds).toEqual(["li_1", "li_2"]);
    expect(body.classificationApplied.skippedReason).toBeNull();
  });

  it("scopes the target lines to the caller's account and shipment", async () => {
    await approve();

    expect(dbMock.shipmentLineItem.findMany.mock.calls[0][0].where).toEqual({
      shipmentId: "shp_1",
      accountId: "acc_1",
      htsCode: "8481.80.5090",
    });
  });

  it("does not leave the replaced code's confidence on the new code", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION, confidence: null });

    await approve();

    expect(dbMock.shipmentLineItem.updateMany.mock.calls[0][0].data.htsConfidence).toBeNull();
  });

  it("reclassifies nothing when the decision does not say which code it replaces", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION, currentHtsCode: null });

    const body = await (await approve()).json();

    expect(dbMock.shipmentLineItem.findMany).not.toHaveBeenCalled();
    expect(dbMock.shipmentLineItem.updateMany).not.toHaveBeenCalled();
    expect(body.classificationApplied.skippedReason).toBe("NO_CURRENT_HTS_CODE");
  });

  it("reports that nothing matched rather than silently applying nothing", async () => {
    dbMock.shipmentLineItem.findMany.mockResolvedValue([]);

    const body = await (await approve()).json();

    expect(dbMock.shipmentLineItem.updateMany).not.toHaveBeenCalled();
    expect(body.classificationApplied.skippedReason).toBe("NO_MATCHING_LINE_ITEMS");
  });

  it("does not reclassify on a decision that carries no proposed code", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION, proposedHtsCode: null });

    const body = await (await approve()).json();

    expect(dbMock.shipmentLineItem.updateMany).not.toHaveBeenCalled();
    expect(body.classificationApplied).toBeNull();
  });

  it("does not reclassify on reject or re-evaluate", async () => {
    for (const action of ["REJECT", "RE_EVALUATE"]) {
      await post({ decisionId: "dec_1", action });
    }

    expect(dbMock.shipmentLineItem.updateMany).not.toHaveBeenCalled();
  });

  it("records what was reclassified in the audit log", async () => {
    await approve();

    const metadata = createAuditLog.mock.calls[0][0].metadata;
    expect(metadata.classificationApplied.proposedHtsCode).toBe("8537.10.2030");
    expect(metadata.classificationApplied.updatedLineItemIds).toEqual(["li_1", "li_2"]);
  });
});
