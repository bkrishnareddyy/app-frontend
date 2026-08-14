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
      htsChange: {
        findMany: vi.fn(),
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

    const mockHtsChanges = [
      {
        changeType: "RATE_CHANGED",
        changedFields: {
          htsNumber: "8541.43.0010",
          oldRate: "2.8%",
          newRate: "5.8%",
        },
      },
    ];

    vi.mocked(db.product.findMany).mockResolvedValue(mockProducts as any);
    vi.mocked(db.shipment.findMany).mockResolvedValue(mockShipments as any);
    vi.mocked(db.drawbackLot.findMany).mockResolvedValue(mockLots as any);
    vi.mocked(db.htsChange.findMany).mockResolvedValue(mockHtsChanges as any);

    const result = await computeRegulatoryImpact("acc_1", ["8541.43.0010"]);

    expect(result.productsAffectedCount).toBe(1);
    expect(result.shipmentsAffectedCount).toBe(1);
    expect(result.lotsAffectedCount).toBe(1);
    
    // Duty delta: 10000 * (0.058 - 0.028) = 10000 * 0.03 = 300.00
    expect(result.estimatedDutyDelta).toBe(300);
  });

  it("returns zero impact for HTS codes not present in the update (Task B-6)", async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([]);
    vi.mocked(db.shipment.findMany).mockResolvedValue([]);
    vi.mocked(db.drawbackLot.findMany).mockResolvedValue([]);
    vi.mocked(db.htsChange.findMany).mockResolvedValue([]);

    const result = await computeRegulatoryImpact("acc_1", ["9999.99.9999"]);

    expect(result.productsAffectedCount).toBe(0);
    expect(result.shipmentsAffectedCount).toBe(0);
    expect(result.lotsAffectedCount).toBe(0);
    expect(result.estimatedDutyDelta).toBe(0);
  });
});

describe("Capability C & D — Landed Cost & Trade Agreement Simulation Tests", () => {
  it("evaluates USMCA zero-Section-301 vs non-claim full rate comparison (Task C-8)", () => {
    const ratesInput = {
      generalDutyRate: "2.8%",
      section301Applicable: true,
      section301AdditionalRate: 25,
    };

    // USMCA preferential claim scenario
    const usmcaBreakdown = computeLandedCost(
      {
        productCost: 10000,
        quantity: 100,
        htsCode: "8541.43.0010",
        countryOfOrigin: "MX",
        tradeAgreementClaim: "USMCA",
        freight: 1000,
        insurance: 100,
      },
      ratesInput
    );

    // Non-claim China origin scenario
    const nonClaimBreakdown = computeLandedCost(
      {
        productCost: 10000,
        quantity: 100,
        htsCode: "8541.43.0010",
        countryOfOrigin: "CN",
        tradeAgreementClaim: null,
        freight: 1000,
        insurance: 100,
      },
      ratesInput
    );

    expect(usmcaBreakdown.baseDuty.toNumber()).toBe(0);
    expect(usmcaBreakdown.section301.toNumber()).toBe(0);

    expect(nonClaimBreakdown.baseDuty.toNumber()).toBe(280); // 10000 * 0.028
    expect(nonClaimBreakdown.section301.toNumber()).toBe(2500); // 10000 * 0.25

    const compareDelta = nonClaimBreakdown.total.minus(usmcaBreakdown.total);
    expect(compareDelta.toNumber()).toBeGreaterThan(2700);
  });

  it("calculates landed cost components with FOB excluding freight and verifies per-unit scaling across quantities (Task D-5)", () => {
    const breakdown10 = computeLandedCost({
      productCost: 5000,
      quantity: 10,
      htsCode: "8541.43.0010",
      countryOfOrigin: "CN",
      freight: 500,
      insurance: 50,
      assists: 100,
      royalties: 50,
      inland: 200,
    });

    const breakdown1000 = computeLandedCost({
      productCost: 500000,
      quantity: 1000,
      htsCode: "8541.43.0010",
      countryOfOrigin: "CN",
      freight: 500,
      insurance: 50,
      assists: 100,
      royalties: 50,
      inland: 200,
    });

    // Customs Value = productCost + assists + royalties (freight & insurance excluded under FOB)
    expect(breakdown10.customsValue.toNumber()).toBe(5150); // 5000 + 100 + 50
    expect(breakdown10.freightToUSPort.toNumber()).toBe(500);
    expect(breakdown10.insuranceToUSPort.toNumber()).toBe(50);

    // Fixed freight & entry fees dilutive scaling per unit
    expect(breakdown10.perUnit.toNumber()).toBeGreaterThan(breakdown1000.perUnit.toNumber());
  });
});
