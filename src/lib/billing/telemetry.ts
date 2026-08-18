import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { evaluateAndRateUsageEvent } from "./ratingEngine";
import { calculateAndRecordEventCost } from "./costingEngine";

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

/** Standard Billing Event Definitions to seed on demand */
export const DEFAULT_BILLING_EVENT_DEFINITIONS = [
  {
    eventCode: "DOCUMENT_PROCESSED",
    name: "Document Processing",
    description: "Ingestion and extraction of commercial document pages",
    category: "DOCUMENT_PROCESSING",
    defaultUnit: "page",
  },
  {
    eventCode: "HTS_CLASSIFICATION_COMPLETED",
    name: "HTS Classification Completed",
    description: "Classification of line item to 10-digit HTS code",
    category: "CLASSIFICATION",
    defaultUnit: "line",
  },
  {
    eventCode: "HTS_MANUAL_REVIEW_COMPLETED",
    name: "Human HTS Classification Review",
    description: "Manual broker review and approval of HTS classification",
    category: "HUMAN_REVIEW",
    defaultUnit: "line",
  },
  {
    eventCode: "PRODUCT_NORMALIZATION_COMPLETED",
    name: "Product Normalization",
    description: "Catalog matching and product data normalization",
    category: "PRODUCT_NORMALIZATION",
    defaultUnit: "item",
  },
  {
    eventCode: "PGA_PROCESSING_COMPLETED",
    name: "PGA Processing",
    description: "Partner Government Agency flag validation and form data prep",
    category: "PGA_PROCESSING",
    defaultUnit: "entry",
  },
  {
    eventCode: "EXCEPTION_MANUALLY_RESOLVED",
    name: "Manual Exception Resolution",
    description: "Broker intervention to resolve shipment validation exception",
    category: "EXCEPTION_RESOLUTION",
    defaultUnit: "exception",
  },
  {
    eventCode: "CUSTOMS_ENTRY_COMPLETED",
    name: "Customs Entry Processing",
    description: "Full customs entry summary processing",
    category: "CUSTOMS_ENTRY",
    defaultUnit: "entry",
  },
  {
    eventCode: "ACE_FILING_TRANSMITTED",
    name: "ACE Filing Transmission",
    description: "Transmission of CBP entry summary to ACE EDI network",
    category: "ACE_FILING",
    defaultUnit: "transmission",
  },
  {
    eventCode: "ISF_FILING_TRANSMITTED",
    name: "ISF Filing Transmission",
    description: "Importer Security Filing transmission",
    category: "ISF_FILING",
    defaultUnit: "filing",
  },
  {
    eventCode: "RECONCILIATION_ENTRY_PREPARED",
    name: "Reconciliation Entry Preparation",
    description: "Reconciliation entry flag assembly and filing prep",
    category: "RECONCILIATION",
    defaultUnit: "entry",
  },
] as const;

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
