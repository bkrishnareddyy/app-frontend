import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

const VERSION_INCLUDE = {
  rules: {
    include: {
      capabilityMappings: {
        include: { eventDefinition: true },
      },
    },
  },
} as const;

/**
 * Resolves the active RateCardVersion for an account, client, and importer.
 * Resolution hierarchy: Importer-specific -> Client-specific -> Account Default.
 * Only versions effective now and not expired are eligible.
 */
export async function resolveActiveRateCardVersion(params: {
  accountId: string;
  clientId?: string | null;
  importerId?: string | null;
}) {
  const { accountId, clientId, importerId } = params;
  const now = new Date();
  const versionWhere = {
    status: "ACTIVE" as const,
    effectiveDate: { lte: now },
    OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
  };

  async function latestVersionForRateCard(where: Record<string, unknown>) {
    const rateCard = await db.rateCard.findFirst({
      where: { accountId, status: "ACTIVE", ...where },
      include: {
        versions: {
          where: versionWhere,
          orderBy: [{ effectiveDate: "desc" }, { version: "desc" }],
          take: 1,
          include: VERSION_INCLUDE,
        },
      },
    });
    return rateCard?.versions[0] ?? null;
  }

  if (importerId) {
    const version = await latestVersionForRateCard({ importerId });
    if (version) return version;
  }

  if (clientId) {
    const version = await latestVersionForRateCard({ clientId, importerId: null });
    if (version) return version;
  }

  return latestVersionForRateCard({ isDefault: true, clientId: null, importerId: null });
}

interface TierConfig {
  fromQty: number;
  toQty: number | null;
  unitRate: number;
}

const ONCE_PER_SHIPMENT_MODELS = new Set(["FLAT_FEE", "PER_SHIPMENT", "PER_ENTRY", "BUNDLED"]);

/**
 * Evaluates a usage event against the active rate card version and creates a
 * ShipmentCharge if billable. A flat/bundled rule may be mapped to many
 * capabilities but is charged only once per shipment and rate-rule version.
 */
export async function evaluateAndRateUsageEvent(usageEventId: string) {
  const usageEvent = await db.usageEvent.findUnique({ where: { id: usageEventId } });
  if (!usageEvent || !usageEvent.shipmentId) return null;

  const activeVersion = await resolveActiveRateCardVersion({
    accountId: usageEvent.accountId,
    clientId: usageEvent.clientId,
    importerId: usageEvent.importerId,
  });

  if (!activeVersion) {
    const existingException = await db.billingException.findFirst({
      where: {
        accountId: usageEvent.accountId,
        usageEventId: usageEvent.id,
        type: "MISSING_RATE_CARD",
        status: "OPEN",
      },
      select: { id: true },
    });
    if (!existingException) {
      await db.billingException.create({
        data: {
          accountId: usageEvent.accountId,
          type: "MISSING_RATE_CARD",
          severity: "HIGH",
          status: "OPEN",
          description: `No active, effective rate card found for Client ${usageEvent.clientId ?? "N/A"}. Event: ${usageEvent.eventCode}`,
          shipmentId: usageEvent.shipmentId,
          clientId: usageEvent.clientId,
          usageEventId: usageEvent.id,
        },
      });
    }
    return null;
  }

  const matchingRule = activeVersion.rules.find((rule) =>
    rule.isBillable && rule.capabilityMappings.some((mapping) => mapping.eventDefinition.eventCode === usageEvent.eventCode)
  );
  if (!matchingRule) return null;

  if (matchingRule.pricingModel === "PER_SUCCESSFUL_OUTCOME" && !usageEvent.success) return null;

  if (ONCE_PER_SHIPMENT_MODELS.has(matchingRule.pricingModel)) {
    const existingCharge = await db.shipmentCharge.findFirst({
      where: {
        accountId: usageEvent.accountId,
        shipmentId: usageEvent.shipmentId,
        rateRuleId: matchingRule.id,
        status: { notIn: ["VOIDED", "REVERSED"] },
      },
    });
    if (existingCharge) return existingCharge;
  }

  const eventQty = Number(usageEvent.quantity);
  const unitPrice = Number(matchingRule.rate);
  let grossAmount = 0;
  const trace: Record<string, unknown> = {
    pricingModel: matchingRule.pricingModel,
    baseRate: unitPrice,
    eventQty,
    includedQty: matchingRule.includedQuantity,
    rateCardVersionId: activeVersion.id,
    rateRuleId: matchingRule.id,
  };

  switch (matchingRule.pricingModel) {
    case "FLAT_FEE":
    case "PER_SHIPMENT":
    case "PER_ENTRY":
    case "BUNDLED":
      grossAmount = unitPrice;
      trace.oncePerShipment = true;
      break;

    case "PER_TRANSACTION":
    case "PER_UNIT":
    case "PER_DOCUMENT":
    case "PER_API_EVENT":
    case "PER_SUCCESSFUL_OUTCOME": {
      const billableQty = Math.max(0, eventQty - matchingRule.includedQuantity);
      grossAmount = billableQty * unitPrice;
      trace.billableQty = billableQty;
      break;
    }

    case "TIERED": {
      const tiers = (matchingRule.tieredConfig as unknown as TierConfig[]) ?? [];
      let totalTieredCharge = 0;
      for (const tier of tiers) {
        const lowerBound = Math.max(1, tier.fromQty);
        const upperBound = tier.toQty ?? eventQty;
        const qtyInTier = Math.max(0, Math.min(eventQty, upperBound) - lowerBound + 1);
        totalTieredCharge += qtyInTier * tier.unitRate;
      }
      grossAmount = totalTieredCharge;
      trace.tieredResult = totalTieredCharge;
      break;
    }

    case "TIME_BASED": {
      const durationHours = (usageEvent.processingDuration ?? 0) / 3_600_000;
      grossAmount = durationHours * unitPrice;
      trace.durationHours = durationHours;
      break;
    }

    case "PERCENTAGE_BASED": {
      const metadata = (usageEvent.metadata ?? {}) as Record<string, unknown>;
      const baseValue = Number(metadata.valueAmount ?? 0);
      grossAmount = baseValue * (unitPrice / 100);
      trace.baseValue = baseValue;
      break;
    }

    case "CONDITIONAL": {
      // Conditions are persisted on the rule. Until a dedicated condition DSL
      // evaluator is introduced, require the producer to explicitly mark the
      // event as qualifying rather than silently billing every event.
      const metadata = (usageEvent.metadata ?? {}) as Record<string, unknown>;
      if (metadata.billingConditionMatched !== true) return null;
      grossAmount = eventQty * unitPrice;
      trace.conditionMatched = true;
      break;
    }

    default:
      grossAmount = eventQty * unitPrice;
      break;
  }

  if (matchingRule.minCharge !== null && grossAmount > 0 && grossAmount < Number(matchingRule.minCharge)) {
    trace.adjustedForMin = Number(matchingRule.minCharge);
    grossAmount = Number(matchingRule.minCharge);
  }
  if (matchingRule.maxCharge !== null && grossAmount > Number(matchingRule.maxCharge)) {
    trace.adjustedForMax = Number(matchingRule.maxCharge);
    grossAmount = Number(matchingRule.maxCharge);
  }

  // A zero-dollar result is legitimate for an included quantity, but it should
  // not create a misleading customer charge row.
  if (grossAmount <= 0) return null;

  const grossDecimal = new Prisma.Decimal(grossAmount);
  return db.shipmentCharge.create({
    data: {
      accountId: usageEvent.accountId,
      shipmentId: usageEvent.shipmentId,
      usageEventId: usageEvent.id,
      rateCardVersionId: activeVersion.id,
      rateRuleId: matchingRule.id,
      description: matchingRule.lineItemName,
      quantity: new Prisma.Decimal(eventQty),
      unitPrice: new Prisma.Decimal(unitPrice),
      grossAmount: grossDecimal,
      discountAmount: new Prisma.Decimal(0),
      netAmount: grossDecimal,
      currency: matchingRule.currency,
      status: "RATED",
      calculationTrace: trace as Prisma.InputJsonValue,
    },
  });
}
