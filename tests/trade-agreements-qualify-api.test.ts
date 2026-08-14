import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = {
  tradeAgreement: { findUnique: vi.fn() },
  shipmentLineItem: { findFirst: vi.fn() },
};

const getAccountContext = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  getAccountContext,
  hasPermission: vi.fn(async () => true),
}));

const { POST } = await import("@/app/api/v1/trade-agreements/qualify/route");

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v1/trade-agreements/qualify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/trade-agreements/qualify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountContext.mockResolvedValue({
      accountId: "acc_1",
      userId: "usr_1",
      roleNames: ["ADMIN"],
      permissions: ["intel.read"],
      isPlatformAdmin: false,
    });
  });

  it("returns error if lineItemId is missing", async () => {
    const res = await POST(makeReq({ agreementCode: "USMCA" }), { params: Promise.resolve({}) } as any);
    const json = await res.json();
    expect(json.error).toBe("lineItemId is required");
  });

  it("returns 400 if neither agreementCode nor agreementId is provided", async () => {
    const res = await POST(makeReq({ lineItemId: "li_123" }), { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("agreementCode or valid agreementId is required");
  });

  it("resolves agreementCode from agreementId if agreementCode is omitted", async () => {
    dbMock.tradeAgreement.findUnique.mockResolvedValue({ id: "ta_1", code: "CAFTA-DR" });
    dbMock.shipmentLineItem.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ lineItemId: "li_123", agreementId: "ta_1" }), { params: Promise.resolve({}) } as any);
    expect(dbMock.tradeAgreement.findUnique).toHaveBeenCalledWith({ where: { id: "ta_1" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 if shipment line item is not found", async () => {
    dbMock.shipmentLineItem.findFirst.mockResolvedValue(null);

    const res = await POST(makeReq({ lineItemId: "li_missing", agreementCode: "USMCA" }), { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Shipment line item not found");
  });

  it("evaluates trade agreement origin qualification successfully for line item", async () => {
    dbMock.shipmentLineItem.findFirst.mockResolvedValue({
      id: "li_1",
      accountId: "acc_1",
      productId: "prod_1",
      htsCode: "8481.80.5090",
      description: "Stainless Steel Valve",
      totalValue: 100,
      countryOfOrigin: "MX",
      product: {
        compositions: [
          { id: "comp_1", material: "Raw Steel Ingot", htsCode: "7218.10.0000", percentage: 30, cost: 30 },
          { id: "comp_2", material: "Rubber Gasket", htsCode: "4016.93.0000", percentage: 10, cost: 10 },
        ],
      },
    });

    const res = await POST(makeReq({ lineItemId: "li_1", agreementCode: "USMCA" }), { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.lineItemId).toBe("li_1");
    expect(json.agreementCode).toBe("USMCA");
    expect(json.qualified).toBe(true);
    expect(typeof json.confidence).toBe("number");
    expect(json.basis).toBeDefined();
    expect(Array.isArray(json.gaps)).toBe(true);
  });
});
