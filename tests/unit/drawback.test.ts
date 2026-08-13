import { describe, it, expect, vi } from "vitest";
import { DrawbackService } from "../../src/modules/drawback/drawback.service";
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
      $transaction: vi.fn((cb) => cb(db)),
    },
  };
});

describe("Capability B — Drawback Matching (Lot Inventory) Tests", () => {
  it("enforces statutory 99% drawback match attribution", async () => {
    // Setup Mock Lots (Import)
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

    // Setup Mock Export
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
