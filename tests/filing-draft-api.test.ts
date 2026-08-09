import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers POST /api/filing, the route the UI actually uses to open an entry
// summary draft. It used to invent block 2 of the Form 7501 and persist duty
// totals that the tariff engine had already flagged as incomplete.

const dbMock = {
  shipment: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  customsFiling: {
    create: vi.fn(),
  },
  hTSCode: {
    findMany: vi.fn(),
  },
};

const getAccountContext = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ getAccountContext, hasPermission: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));

const { POST } = await import("@/app/api/filing/route");

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "li_1",
    htsCode: "8481.80.5090",
    quantity: 10,
    unitPrice: 500,
    totalValue: 5000,
    ...overrides,
  };
}

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "shp_1",
    accountId: "acc_1",
    shipmentNumber: "SHP-26-004872",
    entryType: null,
    lineItems: [lineItem()],
    documents: [],
    ...overrides,
  };
}

/** The rate row that makes the shipment's single line fully rated. */
const RATED = [{ htsCode10: "8481.80.5090", generalDutyRate: "2.5%" }];

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/filing", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

/** The `data` Prisma was asked to write. */
function created() {
  return dbMock.customsFiling.create.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
    getAccountContext.mockResolvedValue({
      accountId: "acc_1",
      userId: "user_1",
      roleNames: ["ADMIN"],
      permissions: [],
      isPlatformAdmin: false,
    });
  dbMock.shipment.findFirst.mockResolvedValue(shipment());
  dbMock.shipment.update.mockResolvedValue({});
  dbMock.hTSCode.findMany.mockResolvedValue(RATED);
  dbMock.customsFiling.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "fil_1",
    ...data,
    shipment: {},
    responses: [],
  }));
});

describe("POST /api/filing: entry type", () => {
  it("rejects a draft when no entry type is declared anywhere", async () => {
    const res = await post({ shipmentId: "shp_1" });

    expect(res.status).toBe(400);
    expect(dbMock.customsFiling.create).not.toHaveBeenCalled();
  });

  it("does not silently record an unknown entry as a consumption entry", async () => {
    const res = await post({ shipmentId: "shp_1" });
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain("Consumption Entry");
  });

  it("uses the entry type recorded on the shipment, in the canonical spelling", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(shipment({ entryType: "21 - Warehouse" }));

    await post({ shipmentId: "shp_1" });

    expect(created().entryType).toBe("21");
  });

  it("lets the caller override the shipment's entry type", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(shipment({ entryType: "21 - Warehouse" }));

    await post({ shipmentId: "shp_1", entryType: "06 - FTZ" });

    expect(created().entryType).toBe("06");
  });

  it("refuses a value that names no CBP entry type instead of storing it", async () => {
    const res = await post({ shipmentId: "shp_1", entryType: "whatever the broker typed" });

    expect(res.status).toBe(400);
    expect(dbMock.customsFiling.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/filing: duty totals", () => {
  it("records duty when every line has a published rate", async () => {
    await post({ shipmentId: "shp_1", entryType: "01" });

    expect(created().totalDuties).toBeGreaterThan(0);
    expect(created().totalAmount).toBeGreaterThan(0);
  });

  it("leaves duty null when a line has no published rate", async () => {
    dbMock.hTSCode.findMany.mockResolvedValue([]);

    await post({ shipmentId: "shp_1", entryType: "01" });

    // An understated total is worse than an absent one: it reads as $0.00 owed.
    expect(created().totalDuties).toBeNull();
    expect(created().totalAmount).toBeNull();
  });

  it("never claims taxes were calculated", async () => {
    await post({ shipmentId: "shp_1", entryType: "01" });

    expect(created().totalTaxes).toBeNull();
  });

  it("records the customs value the duty was computed on", async () => {
    await post({ shipmentId: "shp_1", entryType: "01" });

    expect(created().totalValue).toBe(5000);
  });

  it("is still tenant scoped", async () => {
    dbMock.shipment.findFirst.mockResolvedValue(null);

    const res = await post({ shipmentId: "shp_other", entryType: "01" });

    expect(res.status).toBe(404);
    expect(dbMock.shipment.findFirst.mock.calls[0][0].where.accountId).toBe("acc_1");
  });
});
