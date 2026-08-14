import { describe, it, expect, vi, beforeEach } from "vitest";

// POST /api/advisory/origin-determination performs no origin analysis, but it
// used to hardcode `qualifies: true` with status "Confirmed", criterion
// "Criterion A (Wholly Obtained)", 65% RVC and "net cost" — recording an
// unevaluated line item as entitled to FTA preference (19 U.S.C. § 1592).

const ctxMock = vi.fn();

const dbMock = {
  shipmentLineItem: { findFirst: vi.fn() },
  tradeAgreement: { findUnique: vi.fn(), upsert: vi.fn() },
  originDetermination: { create: vi.fn() },
  exceptionItem: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext: () => ctxMock(),
  hasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn(), AuditAction: { ORIGIN_DETERMINED: "origin.determined" } }));

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
  dbMock.tradeAgreement.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) =>
    where.code === "USMCA" ? { id: "ta_1", code: "USMCA" } : null
  );
  dbMock.tradeAgreement.upsert.mockResolvedValue({ id: "ta_1", code: "USMCA" });
  dbMock.originDetermination.create.mockResolvedValue({ id: "od_1" });
  dbMock.exceptionItem.create.mockResolvedValue({ id: "ex_1" });
});

describe("POST /api/advisory/origin-determination", () => {
  it("rejects an unauthenticated caller", async () => {
    ctxMock.mockResolvedValue(null);
    const res = await post(VALID);
    expect(res.status).toBe(401);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
  });

  it("requires shipmentLineItemId", async () => {
    const res = await post(omit("shipmentLineItemId"));

    expect(res.status).toBe(400);
    expect(dbMock.originDetermination.create).not.toHaveBeenCalled();
  });

  it("rejects a trade agreement code outside the catalogue instead of inventing one", async () => {
    const res = await post({ ...VALID, tradeAgreementCode: "NOT-A-FTA" });

    expect(res.status).toBe(404);
    expect(dbMock.tradeAgreement.upsert).not.toHaveBeenCalled();
  });

  it("evaluates origin determination and persists draft when trade agreement is provided", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    const data = dbMock.originDetermination.create.mock.calls[0][0].data;
    expect(data.shipmentLineItemId).toBe("sli_1");
    expect(data.tradeAgreementId).toBe("ta_1");
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
