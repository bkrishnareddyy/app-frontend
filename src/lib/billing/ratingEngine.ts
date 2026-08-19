import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { evaluateRateRuleCondition } from "./conditionEvaluator";

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

export const ONCE_PER_SHIPMENT_MODELS = new Set(["FLAT_FEE", "PER_SHIPMENT", "PER_ENTRY", "BUNDLED"]);

export interface RateRuleLike {
  id: string;
  pricingModel: string;
  rate: number | { toNumber(): number } | string;
  includedQuantity: number;
  tieredConfig: unknown;
  minCharge: number | { toNumber(): number } | string | null;
  maxCharge: number | { toNumber(): number } | string | null;
  conditions?: unknown;
  lineItemName: string;
  currency: string;
  isBillable: boolean;
}

export interface UsageEventLike {
  eventCode: string;
  quantity: number | { toNumber(): number } | string;
  success: boolean;
  automated: boolean;
  processingDuration?: number | null;
  metadata?: Record<string, unknown> | null;
}

export type ChargeAmountResult =
  | { grossAmount: number; trace: Record<string, unknown> }
  | { conditionFieldMissing: string }
  | null;

/**
 * Pure (no I/O) charge calculation. Given a rate rule and a usage event view,
 * returns the gross amount and calculation trace, null when no charge applies,
 * or { conditionFieldMissing } when a CONDITIONAL rule references a missing
 * field (caller must create a BillingException).
 */
export function computeChargeAmount(
  rule: RateRuleLike,
  event: UsageEventLike
): ChargeAmountResult {
  if (!rule.isBillable) return null;
  if (rule.pricingModel === "PER_SUCCESSFUL_OUTCOME" && !event.success) return null;

  const eventQty = Number(event.quantity);
  const unitPrice = Number(rule.rate);
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;

  let grossAmount = 0;
  const trace: Record<string, unknown> = {
    pricingModel: rule.pricingModel,
    baseRate: unitPrice,
    eventQty,
    includedQty: rule.includedQuantity,
    ruleId: rule.id,
  };

  switch (rule.pricingModel) {
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
      const billableQty = Math.max(0, eventQty - rule.includedQuantity);
      grossAmount = billableQty * unitPrice;
      trace.billableQty = billableQty;
      break;
    }

    case "TIERED": {
      const tiers = (rule.tieredConfig as TierConfig[]) ?? [];
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
      const durationHours = (event.processingDuration ?? 0) / 3_600_000;
      grossAmount = durationHours * unitPrice;
      trace.durationHours = durationHours;
      break;
    }

    case "PERCENTAGE_BASED": {
      const baseValue = Number(metadata.valueAmount ?? 0);
      grossAmount = baseValue * (unitPrice / 100);
      trace.baseValue = baseValue;
      break;
    }

    case "CONDITIONAL": {
      const eventView: Record<string, unknown> = { ...event, metadata };
      const condResult = evaluateRateRuleCondition(rule.conditions, eventView);
      if ("fieldMissing" in condResult) {
        return { conditionFieldMissing: condResult.field };
      }
      if (!condResult.matched) return null;
      grossAmount = eventQty * unitPrice;
      trace.conditionMatched = true;
      break;
    }

    default:
      grossAmount = eventQty * unitPrice;
      break;
  }

  if (rule.minCharge !== null && grossAmount > 0 && grossAmount < Number(rule.minCharge)) {
    trace.adjustedForMin = Number(rule.minCharge);
    grossAmount = Number(rule.minCharge);
  }
  if (rule.maxCharge !== null && grossAmount > Number(rule.maxCharge)) {
    trace.adjustedForMax = Number(rule.maxCharge);
    grossAmount = Number(rule.maxCharge);
  }

  if (grossAmount <= 0) return null;
  return { grossAmount, trace };
}

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

  const matchingRule = activeVersion.rules.find(
    (rule) =>
      rule.isBillable &&
      rule.capabilityMappings.some(
        (mapping) => mapping.eventDefinition.eventCode === usageEvent.eventCode
      )
  );
  if (!matchingRule) return null;

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

  const eventView: UsageEventLike = {
    eventCode: usageEvent.eventCode,
    quantity: usageEvent.quantity,
    success: usageEvent.success,
    automated: usageEvent.automated,
    processingDuration: usageEvent.processingDuration,
    metadata: (usageEvent.metadata as Record<string, unknown>) ?? null,
  };

  const result = computeChargeAmount(
    {
      id: matchingRule.id,
      pricingModel: matchingRule.pricingModel,
      rate: matchingRule.rate,
      includedQuantity: matchingRule.includedQuantity,
      tieredConfig: matchingRule.tieredConfig,
      minCharge: matchingRule.minCharge,
      maxCharge: matchingRule.maxCharge,
      conditions: (matchingRule as unknown as { conditions?: unknown }).conditions,
      lineItemName: matchingRule.lineItemName,
      currency: matchingRule.currency,
      isBillable: matchingRule.isBillable,
    },
    eventView
  );

  if (result === null) return null;

  if ("conditionFieldMissing" in result) {
    await db.billingException.create({
      data: {
        accountId: usageEvent.accountId,
        type: "CONDITION_FIELD_MISSING",
        severity: "MEDIUM",
        status: "OPEN",
        description: `CONDITIONAL rule (${matchingRule.id}) references field "${result.conditionFieldMissing}" which is absent from UsageEvent ${usageEvent.id} (${usageEvent.eventCode}).`,
        shipmentId: usageEvent.shipmentId,
        clientId: usageEvent.clientId,
        usageEventId: usageEvent.id,
      },
    });
    return null;
  }

  const { grossAmount, trace } = result;
  const fullTrace = {
    ...trace,
    rateCardVersionId: activeVersion.id,
    rateRuleId: matchingRule.id,
  };

  const grossDecimal = new Prisma.Decimal(grossAmount);
  return db.shipmentCharge.create({
    data: {
      accountId: usageEvent.accountId,
      shipmentId: usageEvent.shipmentId,
      usageEventId: usageEvent.id,
      rateCardVersionId: activeVersion.id,
      rateRuleId: matchingRule.id,
      description: matchingRule.lineItemName,
      quantity: new Prisma.Decimal(Number(usageEvent.quantity)),
      unitPrice: new Prisma.Decimal(Number(matchingRule.rate)),
      grossAmount: grossDecimal,
      discountAmount: new Prisma.Decimal(0),
      netAmount: grossDecimal,
      currency: matchingRule.currency,
      status: "RATED",
      calculationTrace: fullTrace as Prisma.InputJsonValue,
    },
  });
}
