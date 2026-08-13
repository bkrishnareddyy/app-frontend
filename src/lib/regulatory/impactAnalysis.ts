import { db } from "../db";
import { Decimal } from "../tariff/decimal";

export interface ImpactAnalysisResult {
  productsAffectedCount: number;
  shipmentsAffectedCount: number;
  lotsAffectedCount: number;
  estimatedDutyDelta: number;
  products: Array<{ id: string; partNumber: string | null; description: string; currentHts: string }>;
  shipments: Array<{ id: string; shipmentNumber: string; customsValue: number; dutyDelta: number }>;
  lots: Array<{ id: string; entryNumber: string; htsCode: string; availableQty: number }>;
}

/**
 * Pure engine to compute product and shipment level regulatory update impacts (Task B-1)
 */
export async function computeRegulatoryImpact(
  accountId: string,
  affectedHtsCodes: string[]
): Promise<ImpactAnalysisResult> {
  if (affectedHtsCodes.length === 0) {
    return {
      productsAffectedCount: 0,
      shipmentsAffectedCount: 0,
      lotsAffectedCount: 0,
      estimatedDutyDelta: 0,
      products: [],
      shipments: [],
      lots: [],
    };
  }

  // Normalize HTS codes for matching
  const normalizedHts = affectedHtsCodes.map((c) => c.replace(/[^0-9]/g, ""));

  // 1. Find impacted products
  const products = await db.product.findMany({
    where: {
      accountId,
      classifications: {
        some: {
          normalizedCode: {
            in: normalizedHts,
          },
        },
      },
    },
  });

  // 2. Find impacted shipments (open/in-progress)
  const openShipments = await db.shipment.findMany({
    where: {
      accountId,
      status: { notIn: ["Liquidated", "Closed"] },
      lineItems: {
        some: {
          htsCode: { in: affectedHtsCodes },
        },
      },
    },
    include: {
      lineItems: true,
    },
  });

  // 3. Find affected Drawback lots
  const drawbackLots = await db.drawbackLot.findMany({
    where: {
      accountId,
      htsCode: { in: affectedHtsCodes },
      availableQty: { gt: 0 },
    },
  });

  // 4. Calculate estimated duty exposure delta using Decimal
  let totalDelta = new Decimal(0);
  const shipmentImpacts = openShipments.map((s) => {
    let shipDelta = new Decimal(0);
    s.lineItems.forEach((item) => {
      if (affectedHtsCodes.includes(item.htsCode)) {
        const customsVal = new Decimal(Number(item.totalValue || 0));
        // Assume old rate is general 2.8% and new rate is 4.5% (represented as 1.7% delta)
        const rateDelta = new Decimal(0.017); 
        shipDelta = shipDelta.plus(customsVal.times(rateDelta));
      }
    });

    totalDelta = totalDelta.plus(shipDelta);

    return {
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      customsValue: s.lineItems.reduce((acc, item) => acc + Number(item.totalValue || 0), 0),
      dutyDelta: Math.round(shipDelta.toNumber() * 100) / 100,
    };
  });

  return {
    productsAffectedCount: products.length,
    shipmentsAffectedCount: openShipments.length,
    lotsAffectedCount: drawbackLots.length,
    estimatedDutyDelta: Math.round(totalDelta.toNumber() * 100) / 100,
    products: products.map((p) => ({
      id: p.id,
      partNumber: p.internalSku,
      description: p.productName,
      currentHts: affectedHtsCodes[0],
    })),
    shipments: shipmentImpacts,
    lots: drawbackLots.map((l) => ({
      id: l.id,
      entryNumber: l.entryNumber,
      htsCode: l.htsCode,
      availableQty: Number(l.availableQty),
    })),
  };
}
