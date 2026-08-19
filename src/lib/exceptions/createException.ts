import { db } from "@/lib/db";
import { deliverWebhookEvent } from "@/lib/webhooks/deliver";
import type { Prisma } from "@prisma/client";

/**
 * Creates an ExceptionItem and automatically dispatches the `exception.created` webhook event.
 */
export async function createExceptionItem(
  data: Prisma.ExceptionItemUncheckedCreateInput | Prisma.ExceptionItemCreateInput
) {
  const item = await db.exceptionItem.create({ data });
  deliverWebhookEvent(item.accountId, "exception.created", {
    exceptionId: item.id,
    shipmentId: item.shipmentId ?? null,
    filingId: item.filingId ?? null,
    documentId: item.documentId ?? null,
    category: item.category,
    type: item.type,
    severity: item.severity,
    code: item.code ?? null,
    description: item.description,
  }).catch((err) => console.error("[webhook] Failed to dispatch exception.created:", err));
  return item;
}
