import { describe, it, expect, vi, beforeEach } from "vitest";

// Every mutating API route used to gate on authentication alone. A VIEWER —
// the role handed to auditors, brokers and read-only client users — could
// approve compliance decisions, create filings and transmit entries to CBP.

const dbMock = {
  agentDecision: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  shipment: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  customsFiling: {
    create: vi.fn(),
  },
  htsNode: {
    findMany: vi.fn(),
  },
};

const getAccountContext = vi.fn();
const hasPermission = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getAccountContext, hasPermission }));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));

const { canWrite, denyReadOnly, READ_ONLY_MESSAGE } = await import("@/lib/api/write-access");
const { POST: decisionsPost } = await import("@/app/api/decisions/route");
const { POST: filingPost } = await import("@/app/api/filing/route");

function ctx(roleName: string, isPlatformAdmin = false) {
  return {
    accountId: "acc_1",
    userId: "user_1",
    roleNames: [roleName],
    isPlatformAdmin,
    permissions: ["decisions.approve", "decisions.reject", "decisions.reevaluate"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canWrite", () => {
  it("denies a VIEWER", () => {
    expect(canWrite({ roleNames: ["VIEWER"], isPlatformAdmin: false })).toBe(false);
  });

  it("allows OWNER, ADMIN and MEMBER", () => {
    for (const roleName of ["OWNER", "ADMIN", "MEMBER"]) {
      expect(canWrite({ roleNames: [roleName], isPlatformAdmin: false })).toBe(true);
    }
  });

  it("allows a member who holds a writing role alongside VIEWER", () => {
    expect(canWrite({ roleNames: ["VIEWER", "MEMBER"], isPlatformAdmin: false })).toBe(true);
  });

  it("denies a membership that holds no role at all", () => {
    expect(canWrite({ roleNames: [], isPlatformAdmin: false })).toBe(false);
  });

  it("allows a platform admin regardless of the account role", () => {
    expect(canWrite({ roleNames: ["VIEWER"], isPlatformAdmin: true })).toBe(true);
  });
});

describe("denyReadOnly", () => {
  it("returns a 403 carrying the read-only message for a VIEWER", async () => {
    const res = denyReadOnly({ roleNames: ["VIEWER"], isPlatformAdmin: false });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ error: READ_ONLY_MESSAGE });
  });

  it("returns null for a writer so the handler proceeds", () => {
    expect(denyReadOnly({ roleNames: ["MEMBER"], isPlatformAdmin: false })).toBeNull();
  });
});

describe("POST /api/decisions", () => {
  it("refuses to let a VIEWER approve an agent decision", async () => {
    getAccountContext.mockResolvedValue(ctx("VIEWER"));

    const res = await decisionsPost(
      new Request("http://test/api/decisions", {
        method: "POST",
        body: JSON.stringify({ decisionId: "dec_1", action: "APPROVE" }),
      })
    );

    expect(res.status).toBe(403);
    // The decision must not have been read, let alone written.
    expect(dbMock.agentDecision.findFirst).not.toHaveBeenCalled();
    expect(dbMock.agentDecision.update).not.toHaveBeenCalled();
  });

  it("lets a MEMBER past the role gate", async () => {
    getAccountContext.mockResolvedValue(ctx("MEMBER"));
    dbMock.agentDecision.findFirst.mockResolvedValue(null);

    const res = await decisionsPost(
      new Request("http://test/api/decisions", {
        method: "POST",
        body: JSON.stringify({ decisionId: "dec_1", action: "APPROVE" }),
      })
    );

    expect(res.status).not.toBe(403);
    expect(dbMock.agentDecision.findFirst).toHaveBeenCalled();
  });
});

describe("POST /api/filing", () => {
  it("refuses to let a VIEWER open an entry summary draft", async () => {
    getAccountContext.mockResolvedValue(ctx("VIEWER"));

    const res = await filingPost(
      new Request("http://test/api/filing", {
        method: "POST",
        body: JSON.stringify({ shipmentId: "shp_1", entryType: "Consumption Entry" }),
      })
    );

    expect(res.status).toBe(403);
    expect(dbMock.customsFiling.create).not.toHaveBeenCalled();
  });

  it("lets a platform admin on a VIEWER role through", async () => {
    getAccountContext.mockResolvedValue(ctx("VIEWER", true));
    dbMock.shipment.findFirst.mockResolvedValue(null);

    const res = await filingPost(
      new Request("http://test/api/filing", {
        method: "POST",
        body: JSON.stringify({ shipmentId: "shp_1", entryType: "Consumption Entry" }),
      })
    );

    expect(res.status).not.toBe(403);
    expect(dbMock.shipment.findFirst).toHaveBeenCalled();
  });
});
