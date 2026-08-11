import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers POST /api/decisions. Approving a reclassification used to match the
// target line item by its *current* htsCode string -- which meant a
// first-ever classification (no prior code to match) silently applied
// nothing even after a human clicked Approve. AgentDecision now carries the
// lineNumber it targets, so approving finds the exact line item directly.

const dbMock = {
  agentDecision: { findFirst: vi.fn(), updateMany: vi.fn() },
  shipmentLineItem: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  shipment: { update: vi.fn() },
  user: { findUnique: vi.fn() },
};

const getAccountContext = vi.fn();
const createAuditLog = vi.fn();
const logChangeEvent = vi.fn();
const factServiceRecord = vi.fn();
const reconcileShipment = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getAccountContext }));
vi.mock("@/lib/audit", () => ({ createAuditLog }));
vi.mock("@/modules/audit/factAuditService", () => ({ FactAuditService: { logChangeEvent } }));
vi.mock("@/modules/shipment/factService", () => ({ FactService: { record: factServiceRecord } }));
vi.mock("@/modules/shipment/reconciliationEngine", () => ({ ReconciliationEngine: { reconcileShipment } }));

const { POST } = await import("@/app/api/decisions/route");

const DECISION = {
  id: "dec_1",
  accountId: "acc_1",
  shipmentId: "shp_1",
  confidence: 88,
  lineNumber: 1,
  currentHtsCode: null,
  proposedHtsCode: "8537.10.2030",
  humanNotes: null,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const LINE_ITEM = {
  id: "li_1",
  shipmentId: "shp_1",
  accountId: "acc_1",
  lineNumber: 1,
  htsCode: "UNCLASSIFIABLE",
  htsConfidence: null,
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
  dbMock.shipmentLineItem.findFirst.mockResolvedValue({ ...LINE_ITEM });
  dbMock.shipmentLineItem.update.mockResolvedValue({ ...LINE_ITEM, htsCode: "8537.10.2030" });
  dbMock.shipmentLineItem.updateMany.mockResolvedValue({ count: 1 });
  dbMock.shipment.update.mockResolvedValue({ id: "shp_1" });
  reconcileShipment.mockResolvedValue({});
});

describe("POST /api/decisions — applying an approved classification", () => {
  it("applies the proposed code to the line item this decision targets", async () => {
    const res = await approve();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.shipmentLineItem.update).toHaveBeenCalledWith({
      where: { id: "li_1" },
      data: { htsCode: "8537.10.2030", htsConfidence: 88, status: "Valid" },
    });
    expect(body.classificationApplied.updatedLineItemId).toBe("li_1");
    expect(body.classificationApplied.skippedReason).toBeNull();
  });

  it("scopes the target line to the caller's account, shipment, and line number", async () => {
    await approve();

    expect(dbMock.shipmentLineItem.findFirst.mock.calls[0][0].where).toEqual({
      shipmentId: "shp_1",
      accountId: "acc_1",
      lineNumber: 1,
    });
  });

  it("does not leave the replaced code's confidence on the new code", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION, confidence: null });

    await approve();

    expect(dbMock.shipmentLineItem.update.mock.calls[0][0].data.htsConfidence).toBeNull();
  });

  it("bumps the shipment version and records a user-entered fact -- approving is a user edit, not another agent write", async () => {
    await approve();

    expect(dbMock.shipment.update).toHaveBeenCalledWith({
      where: { id: "shp_1" },
      data: { version: { increment: 1 } },
    });
    expect(factServiceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: "shp_1",
        field: "lineItem.1.htsCode",
        value: "8537.10.2030",
        sourceType: "USER_ENTERED",
      })
    );
    expect(logChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "shp_1", field: "lineItem.1.htsCode", newValue: "8537.10.2030" })
    );
  });

  it("reclassifies nothing when the decision does not carry a line number", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION, lineNumber: null });

    const body = await (await approve()).json();

    expect(dbMock.shipmentLineItem.findFirst).not.toHaveBeenCalled();
    expect(dbMock.shipmentLineItem.update).not.toHaveBeenCalled();
    expect(body.classificationApplied.skippedReason).toBe("NO_LINE_NUMBER");
  });

  it("reports that nothing matched rather than silently applying nothing", async () => {
    dbMock.shipmentLineItem.findFirst.mockResolvedValue(null);

    const body = await (await approve()).json();

    expect(dbMock.shipmentLineItem.update).not.toHaveBeenCalled();
    expect(body.classificationApplied.skippedReason).toBe("LINE_ITEM_NOT_FOUND");
  });

  it("does not reclassify on a decision that carries no proposed code", async () => {
    dbMock.agentDecision.findFirst.mockResolvedValue({ ...DECISION, proposedHtsCode: null });

    const body = await (await approve()).json();

    expect(dbMock.shipmentLineItem.update).not.toHaveBeenCalled();
    expect(body.classificationApplied).toBeNull();
  });

  it("flags the line item for re-review on reject instead of leaving it untouched", async () => {
    await post({ decisionId: "dec_1", action: "REJECT", humanNotes: "Wrong code." });

    expect(dbMock.shipmentLineItem.updateMany).toHaveBeenCalledWith({
      where: { shipmentId: "shp_1", accountId: "acc_1", lineNumber: 1 },
      data: { status: "Review Required" },
    });
    // Nothing on the curated record's value changed, just flagged for
    // re-review, so this does not version the shipment.
    expect(dbMock.shipment.update).not.toHaveBeenCalled();
  });

  it("does not reclassify on re-evaluate", async () => {
    await post({ decisionId: "dec_1", action: "RE_EVALUATE" });

    expect(dbMock.shipmentLineItem.update).not.toHaveBeenCalled();
  });

  it("records what was reclassified in the audit log", async () => {
    await approve();

    const call = createAuditLog.mock.calls.find((c) => c[0].action === "decision.approve");
    const metadata = call?.[0].metadata;
    expect(metadata.classificationApplied.proposedHtsCode).toBe("8537.10.2030");
    expect(metadata.classificationApplied.updatedLineItemId).toBe("li_1");
  });
});
