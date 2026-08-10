import { describe, it, expect, vi, beforeEach } from "vitest";

// POST /api/advisory/origin-determination performs no origin analysis, but it
// used to hardcode `qualifies: true` with status "Confirmed", criterion
// "Criterion A (Wholly Obtained)", 65% RVC and "net cost" — recording an
// unevaluated line item as entitled to FTA preference (19 U.S.C. § 1592).

const ctxMock = vi.fn();

const dbMock = {
  shipmentLineItem: { findFirst: vi.fn() },
  tradeAgreement: { upsert: vi.fn() },
  originDetermination: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));

const route = await import("@/app/api/advisory/origin-determination/route");

function post(body: unknown) {
  return route.POST(
    new Request("http://localhost/api/advisory/origin-determination", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const VALID = {
  shipmentLineItemId: "sli_1",
  tradeAgreementCode: "USMCA",
  qualifies: true,
  criterion: "Criterion B (Tariff Shift)",
  calculationMethod: "net cost",
  regionalValueContentPct: 62.5,
};

function omit(field: keyof typeof VALID) {
  const body: Record<string, unknown> = { ...VALID };
  delete body[field];
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
    ctxMock.mockResolvedValue({
      userId: "u_1",
      accountId: "acc_1",
      roleNames: ["ADMIN"],
      permissions: [],
      isPlatformAdmin: false,
    });
  dbMock.shipmentLineItem.findFirst.mockResolvedValue({ id: "sli_1", accountId: "acc_1" });
  dbMock.tradeAgreement.upsert.mockResolvedValue({ id: "ta_1", code: "USMCA" });
  dbMock.originDetermination.create.mockResolvedValue({ id: "od_1" });
});

describe("POST /api/advisory/origin-determination", () => {
  it("rejects an unauthenticated caller", async () => {
    ctxMock.mockResolvedValue(null);
    const res = await post(VALID);
    expect(res.status).toBe(401);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
  });

  it("will not decide qualification on the caller's behalf", async () => {
    const res = await post(omit("qualifies"));

    expect(res.status).toBe(400);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
  });

  it("requires a criterion rather than assuming wholly obtained", async () => {
    const res = await post(omit("criterion"));

    expect(res.status).toBe(400);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
  });

  it("rejects an unrecognised calculation method", async () => {
    const res = await post({ ...VALID, calculationMethod: "guesswork" });

    expect(res.status).toBe(400);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
  });

  it("rejects a trade agreement code outside the catalogue instead of inventing one", async () => {
    const res = await post({ ...VALID, tradeAgreementCode: "NOT-A-FTA" });

    expect(res.status).toBe(400);
    expect(dbMock.tradeAgreement.upsert).not.toHaveBeenCalled();
  });

  it("records a 0% regional value content as 0, not as 65", async () => {
    const res = await post({ ...VALID, regionalValueContentPct: 0 });

    expect(res.status).toBe(201);
    expect(dbMock.originDetermination.create.mock.calls[0][0].data.regionalValueContentPct).toBe(0);
  });

  it("records an omitted regional value content as null", async () => {
    const res = await post(omit("regionalValueContentPct"));

    expect(res.status).toBe(201);
    expect(dbMock.originDetermination.create.mock.calls[0][0].data.regionalValueContentPct).toBeNull();
  });

  it("persists the caller's assertion as a draft, not a confirmed determination", async () => {
    await post({ ...VALID, qualifies: false });

    const data = dbMock.originDetermination.create.mock.calls[0][0].data;
    expect(data.qualifies).toBe(false);
    expect(data.criterion).toBe("Criterion B (Tariff Shift)");
    expect(data.status).toBe("Draft");
  });

  it("does not leak line items belonging to another tenant", async () => {
    dbMock.shipmentLineItem.findFirst.mockResolvedValue(null);
    const res = await post(VALID);

    expect(res.status).toBe(404);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
    expect(dbMock.shipmentLineItem.findFirst.mock.calls[0][0].where.accountId).toBe("acc_1");
  });
});
