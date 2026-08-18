import { db } from "@/lib/db";
import { computeChargeAmount, RateRuleLike, UsageEventLike } from "./ratingEngine";

export interface SimulationLineResult {
  usageEventId: string;
  eventCode: string;
  clientId: string | null;
  importerId: string | null;
  shipmentId: string | null;
  proposedGross: number;
  actualGross: number;
  delta: number;
}

export interface SimulationSummary {
  proposedRevenue: number;
  actualRevenue: number;
  delta: number;
  deltaPercent: number | null;
  byClient: Record<string, { proposed: number; actual: number; delta: number }>;
  byService: Record<string, { proposed: number; actual: number; delta: number; serviceCode: string }>;
  eventCount: number;
  matchedCount: number;
}

/**
 * Runs proposed rate-card rules against historical usage events without
 * writing anything to ShipmentCharge. Uses the same pure computeChargeAmount
 * path as live rating — simulation and production math are provably identical.
 */
export function simulateRateCard(
  proposedRules: RateRuleLike[],
  proposedMappings: Map<string, string[]>, // ruleId → eventCodes[]
  historicalEvents: Array<UsageEventLike & {
    id: string;
    eventCode: string;
    clientId: string | null;
    importerId: string | null;
    shipmentId: string | null;
    actualGross: number;
    serviceCode: string | null;
  }>
): SimulationSummary {
  const lines: SimulationLineResult[] = [];
  const byClient: SimulationSummary["byClient"] = {};
  const byService: SimulationSummary["byService"] = {};

  // Build reverse map: eventCode → rules that handle it
  const rulesByEvent = new Map<string, RateRuleLike[]>();
  for (const rule of proposedRules) {
    const eventCodes = proposedMappings.get(rule.id) ?? [];
    for (const code of eventCodes) {
      const existing = rulesByEvent.get(code) ?? [];
      existing.push(rule);
      rulesByEvent.set(code, existing);
    }
  }

  let proposedTotal = 0;
  let actualTotal = 0;
  let matchedCount = 0;

  for (const ev of historicalEvents) {
    const rules = rulesByEvent.get(ev.eventCode) ?? [];
    let proposedGross = 0;

    for (const rule of rules) {
      const result = computeChargeAmount(rule, ev);
      if (result && "grossAmount" in result) {
        proposedGross += result.grossAmount;
      }
    }

    if (rules.length > 0) matchedCount++;

    const actual = ev.actualGross;
    const delta = proposedGross - actual;

    lines.push({
      usageEventId: ev.id,
      eventCode: ev.eventCode,
      clientId: ev.clientId,
      importerId: ev.importerId,
      shipmentId: ev.shipmentId,
      proposedGross,
      actualGross: actual,
      delta,
    });

    proposedTotal += proposedGross;
    actualTotal += actual;

    const clientKey = ev.clientId ?? ev.importerId ?? "unassigned";
    const clientBucket = byClient[clientKey] ?? { proposed: 0, actual: 0, delta: 0 };
    clientBucket.proposed += proposedGross;
    clientBucket.actual += actual;
    clientBucket.delta += delta;
    byClient[clientKey] = clientBucket;

    if (ev.serviceCode) {
      const svcBucket = byService[ev.serviceCode] ?? { proposed: 0, actual: 0, delta: 0, serviceCode: ev.serviceCode };
      svcBucket.proposed += proposedGross;
      svcBucket.actual += actual;
      svcBucket.delta += delta;
      byService[ev.serviceCode] = svcBucket;
    }
  }

  const totalDelta = proposedTotal - actualTotal;
  return {
    proposedRevenue: proposedTotal,
    actualRevenue: actualTotal,
    delta: totalDelta,
    deltaPercent: actualTotal > 0 ? (totalDelta / actualTotal) * 100 : null,
    byClient,
    byService,
    eventCount: historicalEvents.length,
    matchedCount,
  };
}

/**
 * Fetches historical usage events for a rate card's target client/importer,
 * runs simulateRateCard against the proposed version's rules, and returns
 * current-vs-proposed revenue comparison without touching any charge records.
 */
export async function runRateSimulation(params: {
  accountId: string;
  proposedRateCardVersionId: string;
  months: number;
}): Promise<SimulationSummary> {
  const { accountId, proposedRateCardVersionId, months } = params;

  const version = await db.rateCardVersion.findFirst({
    where: { id: proposedRateCardVersionId, rateCard: { accountId } },
    include: {
      rateCard: { select: { clientId: true, importerId: true } },
      rules: {
        include: { capabilityMappings: { include: { eventDefinition: true } } },
      },
    },
  });
  if (!version) throw new Error("Rate card version not found");

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  // Build client/importer filter matching the rate card's target
  const clientFilter: { clientId?: string; importerId?: string } = {};
  if (version.rateCard.importerId) clientFilter.importerId = version.rateCard.importerId;
  else if (version.rateCard.clientId) clientFilter.clientId = version.rateCard.clientId;

  const historicalEvents = await db.usageEvent.findMany({
    where: {
      accountId,
      occurredAt: { gte: since },
      ...(clientFilter.importerId ? { importerId: clientFilter.importerId } : {}),
      ...(clientFilter.clientId ? { clientId: clientFilter.clientId } : {}),
    },
    include: {
      charges: {
        select: { grossAmount: true, rateRule: { select: { serviceCode: true } } },
        where: { status: { notIn: ["VOIDED", "REVERSED"] } },
      },
    },
  });

  // Build mapping: ruleId → eventCodes[]
  const proposedMappings = new Map<string, string[]>();
  for (const rule of version.rules) {
    const codes = rule.capabilityMappings.map((m) => m.eventDefinition.eventCode);
    proposedMappings.set(rule.id, codes);
  }

  // Flatten historical events into the shape simulateRateCard expects
  const eventViews = historicalEvents.map((ev) => ({
    id: ev.id,
    eventCode: ev.eventCode,
    clientId: ev.clientId,
    importerId: ev.importerId,
    shipmentId: ev.shipmentId,
    quantity: ev.quantity,
    success: ev.success,
    automated: ev.automated,
    processingDuration: ev.processingDuration,
    metadata: ev.metadata as Record<string, unknown> | null,
    actualGross: ev.charges.reduce((sum, c) => sum + Number(c.grossAmount), 0),
    serviceCode: ev.charges[0]?.rateRule?.serviceCode ?? null,
  }));

  const proposedRules: RateRuleLike[] = version.rules.map((r) => ({
    id: r.id,
    pricingModel: r.pricingModel,
    rate: r.rate,
    includedQuantity: Number(r.includedQuantity),
    tieredConfig: r.tieredConfig,
    minCharge: r.minCharge,
    maxCharge: r.maxCharge,
    conditions: r.conditions,
    lineItemName: r.lineItemName,
    currency: r.currency,
    isBillable: r.isBillable,
  }));

  return simulateRateCard(proposedRules, proposedMappings, eventViews);
}
