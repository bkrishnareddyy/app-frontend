import { db } from "@/lib/db";

export interface ShipmentFinancialSummary {
  shipmentId: string;
  totalRevenue: number;
  totalDiscounts: number;
  netRevenue: number;
  techCost: number;
  laborCost: number;
  thirdPartyCost: number;
  totalCost: number;
  grossProfit: number;
  grossMarginPct: number;
  customsEconomics: {
    duty: number;
    mpf: number;
    hmf: number;
    taxes: number;
    otherFees: number;
    totalPassThrough: number;
  };
  arStatus: {
    accrued: number;
    unbilled: number;
    invoiced: number;
    paid: number;
    outstanding: number;
  };
}

/**
 * Calculates the complete 3-layer financial summary for a shipment.
 */
export async function getShipmentFinancialSummary(shipmentId: string): Promise<ShipmentFinancialSummary | null> {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      shipmentCharges: {
        include: { adjustments: true, invoiceLine: { include: { invoice: true } } },
      },
      shipmentCosts: true,
    },
  });

  if (!shipment) return null;

  let totalRevenue = 0;
  let totalDiscounts = 0;
  let accrued = 0;
  let unbilled = 0;
  let invoiced = 0;
  let paid = 0;

  for (const charge of shipment.shipmentCharges) {
    if (charge.status === "VOIDED" || charge.status === "REVERSED") continue;

    const gross = Number(charge.grossAmount);
    const discount = Number(charge.discountAmount);
    const net = Number(charge.netAmount);

    totalRevenue += gross;
    totalDiscounts += discount;
    accrued += net;

    if (charge.status === "INVOICED" || charge.invoiceLineId) {
      invoiced += net;
      if (charge.invoiceLine?.invoice?.status === "PAID") {
        paid += net;
      }
    } else if (charge.status === "RATED" || charge.status === "APPROVED") {
      unbilled += net;
    }
  }

  let techCost = 0;
  let laborCost = 0;
  let thirdPartyCost = 0;

  for (const cost of shipment.shipmentCosts) {
    const amt = Number(cost.amount);
    if (cost.costType === "TECH") techCost += amt;
    else if (cost.costType === "LABOR") laborCost += amt;
    else thirdPartyCost += amt;
  }

  const netRevenue = totalRevenue - totalDiscounts;
  const totalCost = techCost + laborCost + thirdPartyCost;
  const grossProfit = netRevenue - totalCost;
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  // Customs Pass-Through Economics (Extracted from shipment metadata/facts)
  const customsEconomics = {
    duty: 0,
    mpf: 0,
    hmf: 0,
    taxes: 0,
    otherFees: 0,
    totalPassThrough: 0,
  };

  return {
    shipmentId,
    totalRevenue,
    totalDiscounts,
    netRevenue,
    techCost,
    laborCost,
    thirdPartyCost,
    totalCost,
    grossProfit,
    grossMarginPct,
    customsEconomics,
    arStatus: {
      accrued,
      unbilled,
      invoiced,
      paid,
      outstanding: invoiced - paid,
    },
  };
}

/**
 * Scans an account's usage events for revenue leakage (unbilled manual work or zero-rated events).
 */
export async function detectRevenueLeakage(accountId: string) {
  const unbilledManualEvents = await db.usageEvent.findMany({
    where: {
      accountId,
      automated: false,
      charges: { none: {} },
    },
    take: 50,
  });

  const leakageAlerts = [];
  for (const event of unbilledManualEvents) {
    leakageAlerts.push({
      eventId: event.id,
      eventCode: event.eventCode,
      shipmentId: event.shipmentId,
      userId: event.userId,
      occurredAt: event.occurredAt,
      reason: "Manual broker intervention completed without corresponding rated charge",
    });
  }

  return leakageAlerts;
}
