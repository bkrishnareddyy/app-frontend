import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Calculates internal technology and labor cost for a given usage event.
 * STRICT POLICY: NO fake fallback values or arbitrary default durations/token estimates.
 * If cost parameters or telemetry metadata are missing, logs a BillingException.
 */
export async function calculateAndRecordEventCost(usageEventId: string) {
  const usageEvent = await db.usageEvent.findUnique({
    where: { id: usageEventId },
  });

  if (!usageEvent || !usageEvent.shipmentId) {
    return null;
  }

  // Retrieve account cost profile
  const costProfile = await db.costProfile.findFirst({
    where: { accountId: usageEvent.accountId },
    orderBy: { createdAt: "desc" },
  });

  if (!costProfile) {
    // Strictly log a BillingException instead of fabricating costs from hardcoded fallbacks
    await db.billingException.create({
      data: {
        accountId: usageEvent.accountId,
        type: "MISSING_COST_PROFILE",
        severity: "HIGH",
        status: "OPEN",
        description: `No active CostProfile found for Account ${usageEvent.accountId}. Internal cost calculation skipped for Event ${usageEvent.eventCode}.`,
        shipmentId: usageEvent.shipmentId,
        clientId: usageEvent.clientId,
        usageEventId: usageEvent.id,
      },
    });
    return null;
  }

  const laborRate = Number(costProfile.loadedLaborRate);
  const aiRate = Number(costProfile.aiTokenRate);
  const ocrRate = Number(costProfile.ocrPageRate);
  const aceFee = Number(costProfile.aceTransmissionFee);

  const metadata = (usageEvent.metadata as Record<string, unknown>) ?? {};

  // 1. Labor Cost Calculation (Strictly uses actual recorded processingDuration)
  if (!usageEvent.automated || usageEvent.userId || usageEvent.processingDuration) {
    if (usageEvent.processingDuration && usageEvent.processingDuration > 0) {
      const durationSec = Math.round(usageEvent.processingDuration / 1000);
      const laborCostAmount = (durationSec / 3600) * laborRate;

      await db.shipmentCost.create({
        data: {
          accountId: usageEvent.accountId,
          shipmentId: usageEvent.shipmentId,
          usageEventId: usageEvent.id,
          costType: "LABOR",
          description: `Broker Loaded Labor (${Math.round(durationSec / 60)} min @ $${laborRate.toFixed(2)}/hr)`,
          amount: new Prisma.Decimal(laborCostAmount),
          currency: "USD",
          userId: usageEvent.userId,
          durationSec,
        },
      });
    } else {
      // Log exception for manual intervention lacking duration tracking
      await db.billingException.create({
        data: {
          accountId: usageEvent.accountId,
          type: "UNTRACKED_LABOR_DURATION",
          severity: "MEDIUM",
          status: "OPEN",
          description: `Manual intervention for Event ${usageEvent.eventCode} has no recorded processing duration.`,
          shipmentId: usageEvent.shipmentId,
          clientId: usageEvent.clientId,
          usageEventId: usageEvent.id,
        },
      });
    }
  }

  // 2. Technology Cost Calculation (Strictly uses actual recorded telemetry)
  let techCostAmount = 0;
  let techDescription = "";

  if (usageEvent.eventCode === "DOCUMENT_PROCESSED") {
    const pageCount = Number(usageEvent.quantity);
    if (pageCount > 0) {
      techCostAmount = pageCount * ocrRate;
      techDescription = `OCR Ingestion (${pageCount} pages @ $${ocrRate.toFixed(2)}/page)`;
    }
  } else if (usageEvent.eventCode === "ACE_FILING_TRANSMITTED") {
    techCostAmount = aceFee;
    techDescription = `ACE EDI Gateway Fee ($${aceFee.toFixed(2)}/transmission)`;
  } else if (usageEvent.automated && metadata.tokenCount) {
    const tokenCount = Number(metadata.tokenCount);
    if (tokenCount > 0) {
      techCostAmount = (tokenCount / 1000) * aiRate;
      techDescription = `AI Model Inference (${tokenCount} tokens @ $${aiRate.toFixed(6)}/1k tokens)`;
    }
  }

  if (techCostAmount > 0) {
    await db.shipmentCost.create({
      data: {
        accountId: usageEvent.accountId,
        shipmentId: usageEvent.shipmentId,
        usageEventId: usageEvent.id,
        costType: "TECH",
        description: techDescription,
        amount: new Prisma.Decimal(techCostAmount),
        currency: "USD",
        agentId: usageEvent.agentId,
      },
    });
  }

  return true;
}
