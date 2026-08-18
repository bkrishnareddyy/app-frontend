"use server";

import { db } from "@/lib/db";
import { getAccountContext } from "@/lib/auth";
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
  if (!context) {
    throw new Error("Unauthorized: Account context required");
  }

  // If set as default, unset existing default rate cards for this account
  if (input.isDefault) {
    await db.rateCard.updateMany({
      where: { accountId: context.accountId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const rateCard = await db.rateCard.create({
    data: {
      accountId: context.accountId,
      clientId: input.clientId || null,
      importerId: input.importerId || null,
      name: input.name,
      code: input.code || null,
      description: input.description || null,
      currency: input.currency || "USD",
      isDefault: input.isDefault ?? false,
      currentVersion: 1,
      status: "ACTIVE",
      versions: {
        create: [
          {
            version: 1,
            effectiveDate: new Date(),
            status: "ACTIVE",
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
          },
        ],
      },
    },
  });

  revalidatePath("/app/billing/rate-cards");
  return { success: true, rateCardId: rateCard.id };
}
