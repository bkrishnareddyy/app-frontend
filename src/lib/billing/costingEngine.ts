import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/** Default fallback internal cost profile values */
export const DEFAULT_COST_PROFILE = {
  loadedLaborRate: 72.00,       // $72/hr default loaded broker rate
  aiTokenRate: 0.00015,         // $0.00015 per 1k tokens
  ocrPageRate: 0.05,            // $0.05 per OCR page
  aceTransmissionFee: 0.25,     // $0.25 per ACE submission
};

/**
 * Calculates internal technology and labor cost for a given usage event.
 */
export async function calculateAndRecordEventCost(usageEventId: string) {
  const usageEvent = await db.usageEvent.findUnique({
    where: { id: usageEventId },
  });

  if (!usageEvent || !usageEvent.shipmentId) {
    return null;
  }

  // Retrieve account cost profile or default fallback
  const costProfile = await db.costProfile.findFirst({
    where: { accountId: usageEvent.accountId },
    orderBy: { createdAt: "desc" },
  });

  const laborRate = costProfile ? Number(costProfile.loadedLaborRate) : DEFAULT_COST_PROFILE.loadedLaborRate;
  const aiRate = costProfile ? Number(costProfile.aiTokenRate) : DEFAULT_COST_PROFILE.aiTokenRate;
  const ocrRate = costProfile ? Number(costProfile.ocrPageRate) : DEFAULT_COST_PROFILE.ocrPageRate;
  const aceFee = costProfile ? Number(costProfile.aceTransmissionFee) : DEFAULT_COST_PROFILE.aceTransmissionFee;

  const metadata = (usageEvent.metadata as Record<string, unknown>) ?? {};

  // 1. Labor Cost (if manual work or human review duration is present)
  if (!usageEvent.automated || usageEvent.userId || usageEvent.processingDuration) {
    const durationSec = usageEvent.processingDuration ? Math.round(usageEvent.processingDuration / 1000) : 300; // default 5 mins if unspecified manual work
    const laborCostAmount = (durationSec / 3600) * laborRate;

    await db.shipmentCost.create({
      data: {
        accountId: usageEvent.accountId,
        shipmentId: usageEvent.shipmentId,
        usageEventId: usageEvent.id,
        costType: "LABOR",
        description: `Broker Loaded Labor (${Math.round(durationSec / 60)} min @ $${laborRate}/hr)`,
        amount: new Prisma.Decimal(laborCostAmount),
        currency: "USD",
        userId: usageEvent.userId,
        durationSec,
      },
    });
  }

  // 2. Tech Cost (AI Tokens / OCR Pages / ACE Transmissions)
  let techCostAmount = 0;
  let techDescription = "Internal Automation Processing";

  if (usageEvent.eventCode === "DOCUMENT_PROCESSED") {
    const pageCount = Number(usageEvent.quantity);
    techCostAmount = pageCount * ocrRate;
    techDescription = `OCR & Ingestion (${pageCount} pages @ $${ocrRate}/page)`;
  } else if (usageEvent.eventCode === "ACE_FILING_TRANSMITTED") {
    techCostAmount = aceFee;
    techDescription = `ACE EDI Gateway Fee ($${aceFee}/transmission)`;
  } else if (usageEvent.automated) {
    // Standard AI LLM token usage cost estimation
    const totalTokens = Number(metadata.tokenCount ?? 2500);
    techCostAmount = (totalTokens / 1000) * aiRate;
    techDescription = `AI Model Inference (${totalTokens} tokens @ $${aiRate}/1k tokens)`;
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
