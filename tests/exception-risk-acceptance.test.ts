import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers the risk-acceptance gate on PATCH /api/exceptions/[id]. Waiving closes
// an exception without the underlying problem being fixed, so write access alone
// is not enough: it is an acceptance of the risk on the account's behalf.

const updateException = vi.fn();
const hasPermission = vi.fn();
const getAccountContext = vi.fn();
const createAuditLog = vi.fn();

vi.mock("@/lib/auth", () => ({ hasPermission, getAccountContext }));
vi.mock("@/lib/audit", () => ({ createAuditLog }));
vi.mock("@/modules/exceptions/exception.service", () => ({
  ExceptionService: { updateException },
}));

const { PATCH } = await import("@/app/api/exceptions/[id]/route");
const { RISK_ACCEPTANCE_PERMISSION, isRiskAcceptance } = await import(
  "@/modules/exceptions/exceptionState"
);

beforeEach(() => {
  vi.clearAllMocks();
  getAccountContext.mockResolvedValue({
    accountId: "acc_1",
    userId: "usr_1",
    roleNames: ["ADMIN"],
    permissions: [],
    isPlatformAdmin: false,
  });
  hasPermission.mockImplementation(async (perm: string) => perm === "exceptions.resolve");
  updateException.mockResolvedValue({ id: "exc_1", status: "RESOLVED", version: 2, shipmentId: null });
  createAuditLog.mockResolvedValue({ id: "aud_1" });
});

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://t/api/exceptions/exc_1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "exc_1" }) }
  );
}

describe("risk acceptance permission", () => {
  it("names waiving as the acceptance, not resolving", () => {
    expect(isRiskAcceptance("WAIVED")).toBe(true);
    expect(isRiskAcceptance("RESOLVED")).toBe(false);
    expect(isRiskAcceptance("CANCELLED")).toBe(false);
  });

  it("refuses a waive from a role without the permission", async () => {
    const res = await patch({ status: "WAIVED", resolutionReason: "accepted", expectedVersion: 1 });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain(RISK_ACCEPTANCE_PERMISSION);
    expect(updateException).not.toHaveBeenCalled();
  });

  it("checks the permission before the write, not after", async () => {
    await patch({ status: "waived", resolutionReason: "accepted", expectedVersion: 1 });

    expect(hasPermission).toHaveBeenCalledWith(RISK_ACCEPTANCE_PERMISSION);
    expect(updateException).not.toHaveBeenCalled();
  });

  it("cannot be slipped past the gate with a different casing", async () => {
    for (const status of ["Waived", "waived", " WAIVED "]) {
      const res = await patch({ status, resolutionReason: "accepted", expectedVersion: 1 });
      expect(res.status).toBe(403);
    }
  });

  it("allows the waive once the permission is held", async () => {
    hasPermission.mockImplementation(async (perm: string) => perm === "exceptions.resolve" || perm === "exceptions.waive");

    const res = await patch({ status: "WAIVED", resolutionReason: "accepted", expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(updateException).toHaveBeenCalledTimes(1);
  });

  it("does not gate the ordinary statuses behind risk acceptance", async () => {
    for (const status of ["RESOLVED", "IN_PROGRESS", "CANCELLED"]) {
      const res = await patch({ status, resolutionReason: "done", expectedVersion: 1 });
      expect(res.status).toBe(200);
    }
    expect(hasPermission).not.toHaveBeenCalledWith(RISK_ACCEPTANCE_PERMISSION);
  });

  it("does not gate an update that changes no status", async () => {
    const res = await patch({ shipmentId: "shp_1", expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(hasPermission).not.toHaveBeenCalledWith(RISK_ACCEPTANCE_PERMISSION);
  });

  it("passes the acting user through, so the audit trail names a person", async () => {
    hasPermission.mockResolvedValue(true);

    await patch({ status: "WAIVED", resolutionReason: "accepted", expectedVersion: 1 });

    expect(updateException).toHaveBeenCalledWith(
      "acc_1",
      "exc_1",
      expect.objectContaining({ status: "WAIVED", resolutionReason: "accepted" }),
      expect.objectContaining({ userId: "usr_1" })
    );
  });
});
