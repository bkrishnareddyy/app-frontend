import { describe, it, expect, vi } from "vitest";
import { DrawbackService, InsufficientLotQuantityError } from "../../src/modules/drawback/drawback.service";
import { checkPscEligibility } from "../../src/lib/refunds/pscEligibility";
import { db } from "../../src/lib/db";
import { Decimal } from "../../src/lib/tariff/decimal";

vi.mock("../../src/lib/db", () => {
  return {
    db: {
      customsFiling: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      drawbackLot: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      exportLineItem: {
        findMany: vi.fn(),
      },
      drawbackClaim: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      drawbackClaimSequence: {
        upsert: vi.fn(),
      },
      importerOfRecord: {
        findFirst: vi.fn(),
      },
      refundOpportunity: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb, opts) => cb(db)),
    },
  };
});

describe("Capability B — Drawback Matching (Lot Inventory) Tests", () => {
  it("enforces statutory 99% drawback match attribution", async () => {
    const mockLots = [
      {
        id: "lot_1",
        accountId: "acc_1",
        entryNumber: "ENT-001",
        lineItemId: "li_1",
        htsCode: "8541.43.0010",
        quantity: new Decimal(100),
        availableQty: new Decimal(100),
        reservedQty: new Decimal(0),
        claimedQty: new Decimal(0),
        unitPurchasePrice: new Decimal(10),
        dutyPaidPerUnit: new Decimal(2.50), // base + 301 paid duty per unit
        importDate: new Date(),
        exportDeadline: new Date(Date.now() + 1000 * 60 * 60),
      },
    ];

    const mockExports = [
      {
        id: "exp_1",
        accountId: "acc_1",
        htsCode: "8541.43.0010",
        quantity: 50,
        exportShipment: { exportShipmentNumber: "EXP-999" },
      },
    ];

    vi.mocked(db.exportLineItem.findMany).mockResolvedValue(mockExports as any);
    vi.mocked(db.drawbackLot.findMany).mockResolvedValue(mockLots as any);

    const result = await DrawbackService.matchInventory("acc_1", { matchStrategy: "FIFO" });

    expect(result.proposedMatchesCount).toBe(1);
    const match = result.proposedMatches[0];
    expect(match.matchedQuantity).toBe(50);
    // Attributed duty must be exactly 99% of attributed duties (50 * 2.50 * 0.99 = 123.75)
    expect(match.dutyAttributed).toBe(123.75);
  });

  it("allocates inventory in strict FIFO order by importDate", async () => {
    const olderLot = {
      id: "lot_older",
      accountId: "acc_1",
      entryNumber: "ENT-OLDER",
      lineItemId: "li_older",
      htsCode: "8541.43.0010",
      quantity: new Decimal(20),
      availableQty: new Decimal(20),
      reservedQty: new Decimal(0),
      dutyPaidPerUnit: new Decimal(2.00),
      importDate: new Date("2025-01-01"),
      exportDeadline: new Date("2030-01-01"),
    };
    const newerLot = {
      id: "lot_newer",
      accountId: "acc_1",
      entryNumber: "ENT-NEWER",
      lineItemId: "li_newer",
      htsCode: "8541.43.0010",
      quantity: new Decimal(50),
      availableQty: new Decimal(50),
      reservedQty: new Decimal(0),
      dutyPaidPerUnit: new Decimal(3.00),
      importDate: new Date("2025-06-01"),
      exportDeadline: new Date("2030-06-01"),
    };

    const mockExports = [
      {
        id: "exp_1",
        accountId: "acc_1",
        htsCode: "8541.43.0010",
        quantity: 30,
        exportShipment: { exportShipmentNumber: "EXP-FIFO" },
      },
    ];

    vi.mocked(db.exportLineItem.findMany).mockResolvedValue(mockExports as any);
    vi.mocked(db.drawbackLot.findMany).mockResolvedValue([olderLot, newerLot] as any);

    const result = await DrawbackService.matchInventory("acc_1", { matchStrategy: "FIFO" });

    expect(result.proposedMatches.length).toBe(2);
    // Older lot allocated first (20 units)
    expect(result.proposedMatches[0].matchedQuantity).toBe(20);
    expect(result.proposedMatches[0].importShipmentNumber).toBe("ENT-OLDER");
    // Newer lot allocated remaining 10 units
    expect(result.proposedMatches[1].matchedQuantity).toBe(10);
    expect(result.proposedMatches[1].importShipmentNumber).toBe("ENT-NEWER");
  });

  it("throws InsufficientLotQuantityError when export quantity exceeds available lot quantity", async () => {
    const smallLot = {
      id: "lot_small",
      accountId: "acc_1",
      entryNumber: "ENT-SMALL",
      lineItemId: "li_small",
      htsCode: "8541.43.0010",
      quantity: new Decimal(10),
      availableQty: new Decimal(10),
      reservedQty: new Decimal(0),
      dutyPaidPerUnit: new Decimal(2.00),
      importDate: new Date(),
      exportDeadline: new Date(Date.now() + 1000000),
    };

    const largeExport = [
      {
        id: "exp_large",
        accountId: "acc_1",
        htsCode: "8541.43.0010",
        quantity: 100, // Exceeds 10 available
        exportShipment: { exportShipmentNumber: "EXP-OVER" },
      },
    ];

    vi.mocked(db.exportLineItem.findMany).mockResolvedValue(largeExport as any);
    vi.mocked(db.drawbackLot.findMany).mockResolvedValue([smallLot] as any);

    await expect(
      DrawbackService.matchInventory("acc_1", { matchStrategy: "FIFO" })
    ).rejects.toThrow(InsufficientLotQuantityError);
  });

  it("executes matching inside a Serializable transaction to ensure concurrency safety", async () => {
    vi.mocked(db.exportLineItem.findMany).mockResolvedValue([]);
    await DrawbackService.matchInventory("acc_1", { matchStrategy: "FIFO" });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});

describe("Capability D — PSC Eligibility Tests", () => {
  it("allows PSC for accepted filing with positive duty paid", async () => {
    const mockFiling = {
      id: "filing_1",
      filingStatus: "Accepted",
      totalDuties: new Decimal(500),
      shipment: {
        lineItems: [
          { id: "li_1", drawbackMatches: [] },
        ],
      },
    };

    vi.mocked(db.customsFiling.findFirst).mockResolvedValue(mockFiling as any);

    const result = await checkPscEligibility("acc_1", "filing_1");
    expect(result.eligible).toBe(true);
  });

  it("denies PSC for filing with active drawback claim", async () => {
    const mockFiling = {
      id: "filing_1",
      filingStatus: "Accepted",
      totalDuties: new Decimal(500),
      shipment: {
        lineItems: [
          { id: "li_1", drawbackMatches: [{ id: "match_1" }] },
        ],
      },
    };

    vi.mocked(db.customsFiling.findFirst).mockResolvedValue(mockFiling as any);

    const result = await checkPscEligibility("acc_1", "filing_1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("active drawback claims");
  });
});
