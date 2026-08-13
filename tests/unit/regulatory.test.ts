import { describe, it, expect, vi } from "vitest";
import { computeRegulatoryImpact } from "../../src/lib/regulatory/impactAnalysis";
import { computeLandedCost } from "../../src/lib/tariff/landedCost";
import { db } from "../../src/lib/db";
import { Decimal } from "../../src/lib/tariff/decimal";

vi.mock("../../src/lib/db", () => {
  return {
    db: {
      regulatoryUpdate: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn(),
      },
      shipment: {
        findMany: vi.fn(),
      },
      drawbackLot: {
        findMany: vi.fn(),
      },
      exceptionItem: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      notification: {
        create: vi.fn(),
      },
      user: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("Capability B — Policy Impact Tests", () => {
  it("computes estimated duty exposure delta on open shipments using Decimal", async () => {
    const mockProducts = [
      { id: "prod_1", partNumber: "PART-123", description: "Silicon solar cells" },
    ];

    const mockShipments = [
      {
        id: "ship_1",
        shipmentNumber: "SHP-101",
        lineItems: [
          { id: "li_1", totalValue: new Decimal(10000), htsCode: "8541.43.0010" },
        ],
      },
    ];

    const mockLots = [
      { id: "lot_1", entryNumber: "ENT-201", htsCode: "8541.43.0010", availableQty: new Decimal(50) },
    ];

    vi.mocked(db.product.findMany).mockResolvedValue(mockProducts as any);
    vi.mocked(db.shipment.findMany).mockResolvedValue(mockShipments as any);
    vi.mocked(db.drawbackLot.findMany).mockResolvedValue(mockLots as any);

    const result = await computeRegulatoryImpact("acc_1", ["8541.43.0010"]);

    expect(result.productsAffectedCount).toBe(1);
    expect(result.shipmentsAffectedCount).toBe(1);
    expect(result.lotsAffectedCount).toBe(1);
    
    // Duty delta: 10000 * 0.017 = 170.00
    expect(result.estimatedDutyDelta).toBe(170);
  });
});

describe("Capability D — Landed Cost Simulation Tests", () => {
  it("calculates landed cost components with incoterms FOB customs value", () => {
    const breakdown = computeLandedCost({
      productCost: 5000,
      quantity: 100,
      htsCode: "8541.43.0010",
      countryOfOrigin: "CN",
      freight: 500,
      insurance: 50,
      assists: 100,
      royalties: 50,
      inland: 200,
    });

    // Customs Value = productCost + assists + royalties = 5000 + 100 + 50 = 5150
    expect(breakdown.customsValue.toNumber()).toBe(5150);

    // Per unit cost is total landed cost divided by quantity
    expect(breakdown.perUnit.toNumber()).toBeGreaterThan(50);
  });
});
