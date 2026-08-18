import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { evaluateAndRateUsageEvent } from "./ratingEngine";
import { calculateAndRecordEventCost } from "./costingEngine";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "./constants";

export interface RecordUsageEventInput {
  accountId: string;
  eventCode: string;
  clientId?: string;
  importerId?: string;
  shipmentId?: string;
  userId?: string;
  agentId?: string;
  quantity?: number;
  unit?: string;
  sourceFunction: string;
  sourceApi?: string;
  sourceAgent?: string;
  success?: boolean;
  automated?: boolean;
  processingDuration?: number; // In ms
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export { DEFAULT_BILLING_EVENT_DEFINITIONS };

/**
 * Ensure default billing event definitions exist for an account.
 */
export async function seedBillingEventDefinitions(accountId: string): Promise<void> {
  for (const def of DEFAULT_BILLING_EVENT_DEFINITIONS) {
    await db.billingEventDefinition.upsert({
      where: { eventCode: def.eventCode },
      update: {},
      create: {
        accountId,
        eventCode: def.eventCode,
        name: def.name,
        description: def.description,
        category: def.category as any,
        defaultUnit: def.defaultUnit,
        isBillable: true,
      },
    });
  }
}

/**
 * Record an operational usage event into the immutable ledger.
 * Guarantees idempotency via idempotencyKey constraint.
 */
export async function recordUsageEvent(input: RecordUsageEventInput) {
  await seedBillingEventDefinitions(input.accountId);

  const existing = await db.usageEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    return { status: "IDEMPOTENT_SKIPPED", usageEvent: existing };
  }

  const quantity = new Prisma.Decimal(input.quantity ?? 1.0);

  const usageEvent = await db.usageEvent.create({
    data: {
      accountId: input.accountId,
      eventCode: input.eventCode,
      clientId: input.clientId,
      importerId: input.importerId,
      shipmentId: input.shipmentId,
      userId: input.userId,
      agentId: input.agentId,
      quantity,
      unit: input.unit ?? "unit",
      sourceFunction: input.sourceFunction,
      sourceApi: input.sourceApi,
      sourceAgent: input.sourceAgent,
      success: input.success ?? true,
      automated: input.automated ?? true,
      processingDuration: input.processingDuration,
      idempotencyKey: input.idempotencyKey,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
    },
  });

  try {
    await evaluateAndRateUsageEvent(usageEvent.id);
    await calculateAndRecordEventCost(usageEvent.id);
  } catch (error) {
    console.error("Rating / Costing evaluation error for UsageEvent:", usageEvent.id, error);
  }

  return { status: "RECORDED", usageEvent };
}
