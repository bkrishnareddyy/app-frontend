"use server";

import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export interface CreateRateCardInput {
  name: string;
  code?: string;
  currency?: string;
  isDefault?: boolean;
  clientId?: string;
  importerId?: string;
  description?: string;
  lineItems: Array<{
    lineItemName: string;
    serviceCode: string;
    pricingModel: string;
    unit: string;
    rate: number;
    includedQuantity: number;
  }>;
}

export async function createRateCardAction(input: CreateRateCardInput) {
  const context = await getAccountContext();
  if (!context) throw new Error("Unauthorized: Account context required");
  if (!(await hasPermission("billing.ratecard.manage"))) {
    throw new Error("Forbidden: billing.ratecard.manage permission required");
  }

  if (!input.name.trim()) throw new Error("Rate card name is required");
  if (!input.lineItems.length) throw new Error("At least one rate-card line item is required");
  if (input.lineItems.some((item) => !Number.isFinite(item.rate) || item.rate < 0)) {
    throw new Error("Rate-card rates must be valid non-negative numbers");
  }

  const rateCard = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.rateCard.updateMany({
        where: { accountId: context.accountId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.rateCard.create({
      data: {
        accountId: context.accountId,
        clientId: input.clientId || null,
        importerId: input.importerId || null,
        name: input.name.trim(),
        code: input.code || null,
        description: input.description || null,
        currency: input.currency || "USD",
        isDefault: input.isDefault ?? false,
        currentVersion: 1,
        status: "DRAFT",
        versions: {
          create: [{
            version: 1,
            effectiveDate: new Date(),
            status: "DRAFT",
            rules: {
              create: input.lineItems.map((item) => ({
                lineItemName: item.lineItemName,
                serviceCode: item.serviceCode,
                pricingModel: item.pricingModel as any,
                unit: item.unit,
                rate: item.rate,
                currency: input.currency || "USD",
                includedQuantity: item.includedQuantity,
                isBillable: true,
              })),
            },
          }],
        },
      },
    });
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.ratecard.create",
    entity: "RateCard",
    entityId: rateCard.id,
    metadata: { name: rateCard.name, version: 1, status: "DRAFT" },
  });

  revalidatePath("/app/billing/rate-cards");
  return { success: true, rateCardId: rateCard.id };
}
