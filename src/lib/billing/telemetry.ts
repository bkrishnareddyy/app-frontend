import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { evaluateAndRateUsageEvent } from "./ratingEngine";
import { calculateAndRecordEventCost } from "./costingEngine";
import { DEFAULT_BILLING_EVENT_DEFINITIONS } from "./constants";

/**
 * Maps PipelineOrchestrator agent names (exactly as used in determineAgentsToRun)
 * to billing event codes and quantity resolution strategy.
 *
 * "lineItems" resolves to the number of line items in the agent's input.
 * "pageCount" resolves to output.pageCount from Document Intake.
 * "classifications" resolves to the number of classifications in HTS output.
 * "fixed" always emits quantity = 1.
 *
 * Document Intelligence Agent is intentionally absent — its extraction work is
 * folded into DOCUMENT_PROCESSED (Document Intake), not a separate billable event.
 */
export const AGENT_BILLING_EVENT_MAP: Record<
  string,
  { eventCode: string; quantityFrom: "lineItems" | "pageCount" | "classifications" | "fixed" }
> = {
  "Document Intake Agent": { eventCode: "DOCUMENT_PROCESSED", quantityFrom: "pageCount" },
  "Product Intelligence Agent": { eventCode: "PRODUCT_NORMALIZATION_COMPLETED", quantityFrom: "lineItems" },
  "HTS Classification Agent": { eventCode: "HTS_CLASSIFICATION_COMPLETED", quantityFrom: "classifications" },
  "Origin Rules Agent": { eventCode: "ORIGIN_DETERMINATION_COMPLETED", quantityFrom: "fixed" },
  "Valuation & Assists Agent": { eventCode: "VALUATION_COMPLETED", quantityFrom: "fixed" },
  "Compliance Audit Agent": { eventCode: "COMPLIANCE_REVIEW_COMPLETED", quantityFrom: "fixed" },
  "Filing Readiness Agent": { eventCode: "FILING_READINESS_COMPLETED", quantityFrom: "fixed" },
};

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
  processingDuration?: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export { DEFAULT_BILLING_EVENT_DEFINITIONS };

/**
 * Ensure the shared platform billing-capability catalog exists and reflects
 * the current code definitions. accountId remains a legacy ownership field in
 * the schema; eventCode is globally unique and is the stable mapping contract.
 */
export async function seedBillingEventDefinitions(accountId: string): Promise<void> {
  for (const def of DEFAULT_BILLING_EVENT_DEFINITIONS) {
    await db.billingEventDefinition.upsert({
      where: { eventCode: def.eventCode },
      update: {
        name: def.name,
        description: def.description,
        category: def.category as any,
        defaultUnit: def.defaultUnit,
      },
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
    if (existing.accountId !== input.accountId) {
      throw new Error("Billing idempotency key collision across accounts");
    }
    return { status: "IDEMPOTENT_SKIPPED", usageEvent: existing };
  }

  const definition = await db.billingEventDefinition.findUnique({
    where: { eventCode: input.eventCode },
    select: { defaultUnit: true },
  });
  if (!definition) {
    throw new Error(`Unknown billing event code: ${input.eventCode}`);
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
      unit: input.unit ?? definition.defaultUnit,
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
