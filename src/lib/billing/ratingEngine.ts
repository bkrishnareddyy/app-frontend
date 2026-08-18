import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Resolves the active RateCardVersion for an account, client, and importer.
 * Resolution hierarchy: Importer-specific -> Client-specific -> Account Default.
 */
export async function resolveActiveRateCardVersion(params: {
  accountId: string;
  clientId?: string | null;
  importerId?: string | null;
}) {
  const { accountId, clientId, importerId } = params;

  // 1. Try Importer-specific Rate Card
  if (importerId) {
    const importerRateCard = await db.rateCard.findFirst({
      where: {
        accountId,
        importerId,
        status: "ACTIVE",
      },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
          include: {
            rules: {
              include: {
                capabilityMappings: {
                  include: { eventDefinition: true },
                },
              },
            },
          },
        },
      },
    });
    if (importerRateCard?.versions[0]) {
      return importerRateCard.versions[0];
    }
  }

  // 2. Try Client-specific Rate Card
  if (clientId) {
    const clientRateCard = await db.rateCard.findFirst({
      where: {
        accountId,
        clientId,
        status: "ACTIVE",
      },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
          include: {
            rules: {
              include: {
                capabilityMappings: {
                  include: { eventDefinition: true },
                },
              },
            },
          },
        },
      },
    });
    if (clientRateCard?.versions[0]) {
      return clientRateCard.versions[0];
    }
  }

  // 3. Try Default Brokerage Rate Card
  const defaultRateCard = await db.rateCard.findFirst({
    where: {
      accountId,
      isDefault: true,
      status: "ACTIVE",
    },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
        take: 1,
        include: {
          rules: {
            include: {
              capabilityMappings: {
                include: { eventDefinition: true },
              },
            },
          },
        },
      },
    },
  });

  return defaultRateCard?.versions[0] ?? null;
}

interface TierConfig {
  fromQty: number;
  toQty: number | null; // null for infinity
  unitRate: number;
}

/**
 * Evaluates a usage event against the active rate card version and generates a ShipmentCharge if billable.
 */
export async function evaluateAndRateUsageEvent(usageEventId: string) {
  const usageEvent = await db.usageEvent.findUnique({
    where: { id: usageEventId },
  });

  if (!usageEvent || !usageEvent.shipmentId) {
    return null; // Rating requires an associated shipment
  }

  const activeVersion = await resolveActiveRateCardVersion({
    accountId: usageEvent.accountId,
    clientId: usageEvent.clientId,
    importerId: usageEvent.importerId,
  });

  if (!activeVersion) {
    // Record billing exception: Missing Rate Card
    await db.billingException.create({
      data: {
        accountId: usageEvent.accountId,
        type: "MISSING_RATE_CARD",
        severity: "HIGH",
        status: "OPEN",
        description: `No active rate card found for Account ${usageEvent.accountId}, Client ${usageEvent.clientId ?? "N/A"}. Event: ${usageEvent.eventCode}`,
        shipmentId: usageEvent.shipmentId,
        clientId: usageEvent.clientId,
        usageEventId: usageEvent.id,
      },
    });
    return null;
  }

  // Find matching RateRule mapped to this billing event code
  const matchingRule = activeVersion.rules.find((rule) =>
    rule.capabilityMappings.some((m) => m.eventDefinition.eventCode === usageEvent.eventCode)
  );

  if (!matchingRule || !matchingRule.isBillable) {
    return null; // Event is non-billable or not covered by rate card
  }

  const eventQty = Number(usageEvent.quantity);

  // Outcome-based check
  if (matchingRule.pricingModel === "PER_SUCCESSFUL_OUTCOME" && !usageEvent.success) {
    return null; // Unsuccessful outcome is not billed under PER_SUCCESSFUL_OUTCOME
  }

  let grossAmount = 0;
  let unitPrice = Number(matchingRule.rate);
  const trace: Record<string, unknown> = {
    pricingModel: matchingRule.pricingModel,
    baseRate: unitPrice,
    eventQty,
    includedQty: matchingRule.includedQuantity,
  };

  // Evaluate Pricing Models
  switch (matchingRule.pricingModel) {
    case "FLAT_FEE":
    case "PER_SHIPMENT":
    case "PER_ENTRY":
      grossAmount = unitPrice;
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
      let remainingQty = eventQty;

      for (const tier of tiers) {
        if (remainingQty <= 0) break;
        const tierCap = tier.toQty ? tier.toQty - tier.fromQty + 1 : remainingQty;
        const qtyInTier = Math.min(remainingQty, tierCap);
        totalTieredCharge += qtyInTier * tier.unitRate;
        remainingQty -= qtyInTier;
      }
      grossAmount = totalTieredCharge;
      trace.tieredResult = totalTieredCharge;
      break;
    }

    case "TIME_BASED": {
      // Duration in ms converted to hours
      const durationHours = (usageEvent.processingDuration ?? 0) / (1000 * 60 * 60);
      grossAmount = durationHours * unitPrice;
      trace.durationHours = durationHours;
      break;
    }

    case "PERCENTAGE_BASED": {
      const baseValue = Number((usageEvent.metadata as Record<string, unknown>)?.valueAmount ?? 0);
      grossAmount = baseValue * (unitPrice / 100);
      trace.baseValue = baseValue;
      break;
    }

    default:
      grossAmount = eventQty * unitPrice;
      break;
  }

  // Apply Min / Max constraints
  if (matchingRule.minCharge && grossAmount > 0 && grossAmount < Number(matchingRule.minCharge)) {
    trace.adjustedForMin = Number(matchingRule.minCharge);
    grossAmount = Number(matchingRule.minCharge);
  }
  if (matchingRule.maxCharge && grossAmount > Number(matchingRule.maxCharge)) {
    trace.adjustedForMax = Number(matchingRule.maxCharge);
    grossAmount = Number(matchingRule.maxCharge);
  }

  const grossDecimal = new Prisma.Decimal(grossAmount);
  const netDecimal = grossDecimal; // Initial net = gross until discount applied

  const charge = await db.shipmentCharge.create({
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
      netAmount: netDecimal,
      currency: matchingRule.currency,
      status: "RATED",
      calculationTrace: trace as Prisma.InputJsonValue,
    },
  });

  return charge;
}
