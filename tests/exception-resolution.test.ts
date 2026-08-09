import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers closing an exception. The service used to validate a resolution reason
// and then drop it: the update payload never carried it and there is no column
// for it, so a resolved exception recorded that it was closed and nothing about
// why. It also wrote whatever casing the client sent into a column that rows are
// created in as "Open", leaving two vocabularies in one field.

const dbMock = {
  exceptionItem: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  shipment: { findFirst: vi.fn() },
};

const createAuditLog = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ createAuditLog }));

const { ExceptionService } = await import("@/modules/exceptions/exception.service");
const {
  EXCEPTION_STATES,
  normalizeExceptionStatus,
  openStatusVariants,
  requiresResolutionReason,
  statusVariants,
} = await import("@/modules/exceptions/exceptionState");

const EXISTING = { id: "exc_1", accountId: "acc_1", status: "Open", version: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.exceptionItem.findFirst.mockResolvedValue(EXISTING);
  dbMock.exceptionItem.update.mockResolvedValue({ id: "exc_1", status: "RESOLVED", version: 4 });
  dbMock.shipment.findFirst.mockResolvedValue({ id: "shp_1" });
  createAuditLog.mockResolvedValue({ id: "aud_1" });
});

function update(input: Record<string, unknown>) {
  return ExceptionService.updateException(
    "acc_1",
    "exc_1",
    { expectedVersion: 3, ...input } as never,
    "usr_1"
  );
}

describe("exception status vocabulary", () => {
  it("reads the casing rows are actually created in", () => {
    expect(normalizeExceptionStatus("Open")).toBe("OPEN");
    expect(normalizeExceptionStatus("in progress")).toBe("IN_PROGRESS");
    expect(normalizeExceptionStatus("Waiting-For-Importer")).toBe("WAITING_FOR_IMPORTER");
  });

  it("reads back every casing statusVariants claims the column can hold", () => {
    for (const state of EXCEPTION_STATES) {
      for (const variant of statusVariants(state)) {
        expect(normalizeExceptionStatus(variant)).toBe(state);
      }
    }
  });

  it("refuses a status it does not know rather than inventing one", () => {
    expect(normalizeExceptionStatus("almost done")).toBeNull();
    expect(normalizeExceptionStatus("")).toBeNull();
    expect(normalizeExceptionStatus(null)).toBeNull();
  });

  it("lists both casings a state is known to be stored in, since rows are created as Open", () => {
    expect(statusVariants("IN_PROGRESS")).toEqual(["IN_PROGRESS", "InProgress"]);
    expect(statusVariants("OPEN")).toEqual(["OPEN", "Open"]);
    expect(openStatusVariants()).toContain("Open");
    expect(openStatusVariants()).not.toContain("RESOLVED");
  });

  it("requires a reason for the states that assert the problem was dealt with", () => {
    expect(requiresResolutionReason("RESOLVED")).toBe(true);
    expect(requiresResolutionReason("WAIVED")).toBe(true);
    // Cancelling says the exception should not have been raised, not that it was handled.
    expect(requiresResolutionReason("CANCELLED")).toBe(false);
    expect(requiresResolutionReason("IN_PROGRESS")).toBe(false);
  });
});

describe("closing an exception", () => {
  it("records the stated reason, because no column holds it", async () => {
    await update({ status: "RESOLVED", resolutionReason: "Corrected invoice received" });

    expect(createAuditLog).toHaveBeenCalledTimes(1);
    const entry = createAuditLog.mock.calls[0][0];
    expect(entry.action).toBe("exception.resolve");
    expect(entry.entityId).toBe("exc_1");
    expect(entry.userId).toBe("usr_1");
    expect(entry.metadata.resolutionReason).toBe("Corrected invoice received");
    expect(entry.metadata.fromStatus).toBe("Open");
    expect(entry.metadata.toStatus).toBe("RESOLVED");
  });

  it("fails closed, so a lost audit write cannot leave a closed exception with no reason", async () => {
    createAuditLog.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      update({ status: "RESOLVED", resolutionReason: "Corrected invoice received" })
    ).rejects.toThrow("audit unavailable");

    expect(dbMock.exceptionItem.update).not.toHaveBeenCalled();
  });

  it("refuses to waive without a reason, not only to resolve without one", async () => {
    await expect(update({ status: "WAIVED" })).rejects.toThrow(/reason is required/i);
    await expect(update({ status: "RESOLVED", resolutionReason: "   " })).rejects.toThrow(
      /reason is required/i
    );
    expect(dbMock.exceptionItem.update).not.toHaveBeenCalled();
  });

  it("stores the canonical status rather than the casing the caller happened to send", async () => {
    await update({ status: "in progress" });

    expect(dbMock.exceptionItem.update.mock.calls[0][0].data.status).toBe("IN_PROGRESS");
  });

  it("stamps resolvedAt for every closing state, not only RESOLVED", async () => {
    await update({ status: "CANCELLED" });
    expect(dbMock.exceptionItem.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);

    dbMock.exceptionItem.update.mockClear();
    await update({ status: "IN_PROGRESS" });
    expect(dbMock.exceptionItem.update.mock.calls[0][0].data.resolvedAt).toBeUndefined();
  });

  it("does not audit a resolution for an ordinary status change", async () => {
    await update({ status: "READY_FOR_REVIEW" });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a status outside the vocabulary", async () => {
    await expect(update({ status: "DONE" })).rejects.toThrow(/Invalid exception status state/);
  });

  it("still refuses a stale update before writing anything", async () => {
    dbMock.exceptionItem.findFirst.mockResolvedValue({ ...EXISTING, version: 9 });

    await expect(update({ status: "RESOLVED", resolutionReason: "ok" })).rejects.toThrow(
      "STALE_VERSION"
    );
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(dbMock.exceptionItem.update).not.toHaveBeenCalled();
  });
});

describe("assigning an exception to a shipment", () => {
  it("attaches an unassigned intake once a target is known", async () => {
    await update({ shipmentId: "shp_1" });

    expect(dbMock.shipment.findFirst.mock.calls[0][0].where).toEqual({
      id: "shp_1",
      accountId: "acc_1",
    });
    expect(dbMock.exceptionItem.update.mock.calls[0][0].data.shipmentId).toBe("shp_1");
  });

  it("refuses a shipment belonging to another account", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);

    await expect(update({ shipmentId: "shp_other" })).rejects.toThrow("SHIPMENT_NOT_FOUND");
    expect(dbMock.exceptionItem.update).not.toHaveBeenCalled();
  });

  it("leaves the shipment alone when the caller did not mention it", async () => {
    await update({ status: "IN_PROGRESS" });

    expect(dbMock.shipment.findFirst).not.toHaveBeenCalled();
    expect(dbMock.exceptionItem.update.mock.calls[0][0].data.shipmentId).toBeUndefined();
  });
});

describe("listing exceptions", () => {
  beforeEach(() => {
    dbMock.exceptionItem.findMany.mockResolvedValue([]);
  });

  it("matches every casing the column holds for the requested status", async () => {
    await ExceptionService.listExceptions("acc_1", "usr_1", { status: "in_progress" });

    expect(dbMock.exceptionItem.findMany.mock.calls[0][0].where.status).toEqual({
      in: ["IN_PROGRESS", "InProgress"],
    });
  });

  it("returns nothing for an unknown status instead of falling back to everything", async () => {
    await ExceptionService.listExceptions("acc_1", "usr_1", { status: "nonsense" });

    expect(dbMock.exceptionItem.findMany.mock.calls[0][0].where.status).toEqual({ in: [] });
  });

  it("keeps every declared state reachable", () => {
    for (const state of EXCEPTION_STATES) {
      expect(normalizeExceptionStatus(state)).toBe(state);
    }
  });
});
