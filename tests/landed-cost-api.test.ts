import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers POST /api/simulator/scenarios/[id]/line-items. freightCost and
// insuranceCost are non-null columns with a 0 default, so omitting them used to
// produce a "landed cost" that quietly excluded freight and insurance.

const dbMock = {
  landedCostScenario: { findFirst: vi.fn() },
  htsNode: { findFirst: vi.fn() },
  landedCostScenarioLineItem: { create: vi.fn() },
};

const getAccountContext = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getAccountContext, hasPermission: vi.fn(async () => true) }));

const { POST } = await import("@/app/api/simulator/scenarios/[id]/line-items/route");

const HTS = {
  id: "hts_1",
  htsNumberDisplay: "8481.80.5090",
  htsNumberNormalized: "8481805090",
  description: "Valves",
  dutyRates: [{ rateColumn: "General", rawRateText: "2.5%" }],
};

const VALID = {
  htsCode10: "8481.80.5090",
  unitValue: 100,
  quantity: 10,
  freightCost: 250,
  insuranceCost: 50,
};

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "scn_1" }) }
  );
}

function created() {
  return dbMock.landedCostScenarioLineItem.create.mock.calls[0][0].data;
}

function omit(field: keyof typeof VALID) {
  const body: Record<string, unknown> = { ...VALID };
  delete body[field];
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
    getAccountContext.mockResolvedValue({
      accountId: "acc_1",
      userId: "u_1",
      roleNames: ["ADMIN"],
      permissions: [],
      isPlatformAdmin: false,
    });
  dbMock.landedCostScenario.findFirst.mockResolvedValue({ id: "scn_1", accountId: "acc_1" });
  dbMock.htsNode.findFirst.mockResolvedValue(HTS);
  dbMock.landedCostScenarioLineItem.create.mockImplementation(async ({ data }: { data: unknown }) => data);
});

describe("POST /api/simulator/scenarios/[id]/line-items", () => {
  it("refuses a line item that does not declare freight", async () => {
    const res = await post(omit("freightCost"));

    expect(res.status).toBe(400);
    expect(dbMock.landedCostScenarioLineItem.create).not.toHaveBeenCalled();
  });

  it("refuses a line item that does not declare insurance", async () => {
    const res = await post(omit("insuranceCost"));

    expect(res.status).toBe(400);
    expect(dbMock.landedCostScenarioLineItem.create).not.toHaveBeenCalled();
  });

  it("refuses a negative cost", async () => {
    const res = await post({ ...VALID, freightCost: -1 });

    expect(res.status).toBe(400);
  });

  it("accepts a declared zero and keeps it zero", async () => {
    const res = await post({ ...VALID, freightCost: 0, insuranceCost: 0 });

    expect(res.status).toBe(201);
    expect(created().freightCost).toBe(0);
    expect(created().insuranceCost).toBe(0);
  });

  it("includes the declared freight and insurance in the landed cost", async () => {
    await post(VALID);

    const data = created();
    // 1000 customs value + 2.5% duty + MPF floor + HMF + 250 freight + 50 insurance
    expect(data.freightCost).toBe(250);
    expect(data.insuranceCost).toBe(50);
    expect(data.computedLandedCost).toBe(
      1000 + Number(data.computedDuty) + Number(data.computedFees) + 250 + 50
    );
  });

  it("does not create a line item on another account's scenario", async () => {
    dbMock.landedCostScenario.findFirst.mockResolvedValue(null);

    const res = await post(VALID);

    expect(res.status).toBe(404);
    expect(dbMock.landedCostScenario.findFirst.mock.calls[0][0].where.accountId).toBe("acc_1");
  });
});
