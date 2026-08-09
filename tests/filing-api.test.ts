import { describe, it, expect, vi, beforeEach } from "vitest";

// This suite previously exercised a `FilingApiHandlerMock` class declared in this
// same file and imported no production code, so every assertion was checking that
// the mock returned its own seed data. It now drives the real filing service and
// the real tariff engine.

const dbMock = {
  customsFiling: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  customsResponse: {
    create: vi.fn(),
  },
  filingSnapshot: {
    create: vi.fn(),
  },
  hTSCode: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const { FilingService } = await import("@/modules/filings/filing.service");

/** A line item shaped as the transmit path reads it. */
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

function filingRecord(lineItems: unknown[]) {
  return {
    id: "fil_1",
    accountId: "acc_1",
    entryNumber: "5901-26-004872",
    filingStatus: "BrokerApproved",
    shipment: { id: "shp_1", lineItems, documents: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.customsFiling.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "fil_1",
    ...data,
  }));
  dbMock.customsResponse.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "resp_1",
    ...data,
  }));
});

describe("FilingService.transmitFiling: duty completeness", () => {
  it("refuses to transmit when a line has no published duty rate", async () => {
    dbMock.customsFiling.findFirst.mockResolvedValue(
      filingRecord([lineItem(), lineItem({ id: "li_2", htsCode: "9999.99.9999" })])
    );
    // Only the first code resolves, so the second line is unrated.
    dbMock.hTSCode.findMany.mockResolvedValue([
      { htsCode10: "8481.80.5090", generalDutyRate: "2.8%" },
    ]);

    await expect(FilingService.transmitFiling("acc_1", "user_1", "fil_1")).rejects.toThrow(
      /1 of 2 line\(s\) have no published duty rate/
    );
    expect(dbMock.customsFiling.update).not.toHaveBeenCalled();
    expect(dbMock.customsResponse.create).not.toHaveBeenCalled();
  });

  it("transmits when every line resolves to a published rate", async () => {
    dbMock.customsFiling.findFirst.mockResolvedValue(filingRecord([lineItem()]));
    dbMock.hTSCode.findMany.mockResolvedValue([
      { htsCode10: "8481.80.5090", generalDutyRate: "2.8%" },
    ]);

    const result = await FilingService.transmitFiling("acc_1", "user_1", "fil_1");

    expect(result.filing.filingStatus).toBe("Transmitted");
    expect(result.filing.submittedAt).toBeInstanceOf(Date);
    expect(dbMock.customsResponse.create).toHaveBeenCalledOnce();
  });

  it("treats a genuine 0% rate as rated rather than unknown", async () => {
    dbMock.customsFiling.findFirst.mockResolvedValue(filingRecord([lineItem()]));
    dbMock.hTSCode.findMany.mockResolvedValue([
      { htsCode10: "8481.80.5090", generalDutyRate: "0%" },
    ]);

    const result = await FilingService.transmitFiling("acc_1", "user_1", "fil_1");

    expect(result.filing.filingStatus).toBe("Transmitted");
  });

  it("still refuses a filing with no line items at all", async () => {
    dbMock.customsFiling.findFirst.mockResolvedValue(filingRecord([]));
    dbMock.hTSCode.findMany.mockResolvedValue([]);

    await expect(FilingService.transmitFiling("acc_1", "user_1", "fil_1")).rejects.toThrow(
      /without line items/
    );
  });

  it("refuses to transmit from a status the state machine does not allow", async () => {
    dbMock.customsFiling.findFirst.mockResolvedValue({
      ...filingRecord([lineItem()]),
      filingStatus: "Draft",
    });
    dbMock.hTSCode.findMany.mockResolvedValue([
      { htsCode10: "8481.80.5090", generalDutyRate: "2.8%" },
    ]);

    await expect(FilingService.transmitFiling("acc_1", "user_1", "fil_1")).rejects.toThrow();
    expect(dbMock.customsFiling.update).not.toHaveBeenCalled();
  });

  it("does not leak another account's filing", async () => {
    dbMock.customsFiling.findFirst.mockResolvedValue(null);

    await expect(FilingService.transmitFiling("acc_other", "user_1", "fil_1")).rejects.toThrow(
      "NOT_FOUND"
    );
    const where = dbMock.customsFiling.findFirst.mock.calls[0][0].where;
    expect(where.accountId).toBe("acc_other");
  });
});
