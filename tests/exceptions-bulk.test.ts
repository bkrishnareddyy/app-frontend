import { describe, it, expect, vi, beforeEach } from "vitest";

const updateException = vi.fn();
const hasPermission = vi.fn();
const getAccountContext = vi.fn();
const createAuditLog = vi.fn();
const findFirst = vi.fn();

vi.mock("@/lib/auth", () => ({ hasPermission, getAccountContext }));
vi.mock("@/lib/audit", () => ({ createAuditLog }));
vi.mock("@/lib/db", () => ({
  db: {
    exceptionItem: {
      findFirst,
    },
  },
}));
vi.mock("@/modules/exceptions/exception.service", () => ({
  ExceptionService: { updateException },
}));

const { POST, PATCH } = await import("@/app/api/exceptions/bulk/route");

beforeEach(() => {
  vi.clearAllMocks();
  getAccountContext.mockResolvedValue({
    accountId: "acc_1",
    userId: "usr_1",
    firstName: "Test",
    lastName: "User",
    roleNames: ["ADMIN"],
    permissions: ["exceptions.resolve"],
    isPlatformAdmin: false,
  });
  hasPermission.mockResolvedValue(true);
  findFirst.mockImplementation(({ where }) => {
    return Promise.resolve({ id: where.id, version: 1, status: "OPEN" });
  });
  updateException.mockResolvedValue({ id: "exc_1", status: "WAIVED", version: 2 });
  createAuditLog.mockResolvedValue({ id: "aud_1" });
});

function postBulk(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/exceptions/bulk", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    undefined
  );
}

describe("POST/PATCH /api/exceptions/bulk", () => {
  it("exports both POST and PATCH handlers", () => {
    expect(POST).toBeDefined();
    expect(PATCH).toBeDefined();
    expect(POST).toBe(PATCH);
  });

  it("passes resolutionReasonCode to updateException for bulk waive calls", async () => {
    const res = await postBulk({
      exceptionIds: ["exc_1", "exc_2"],
      status: "WAIVED",
      resolutionReason: "Business decision",
      resolutionReasonCode: "ACCEPT_DOC_DISCREPANCY",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);

    expect(updateException).toHaveBeenCalledTimes(2);
    expect(updateException).toHaveBeenCalledWith(
      "acc_1",
      "exc_1",
      expect.objectContaining({
        status: "WAIVED",
        resolutionReason: "Business decision",
        resolutionReasonCode: "ACCEPT_DOC_DISCREPANCY",
        expectedVersion: 1,
      }),
      expect.objectContaining({ userId: "usr_1", name: "Test User" })
    );
  });
});
