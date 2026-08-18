"use server";

import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";

function readNonNegative(formData: FormData, name: string) {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

export async function saveCostProfileAction(formData: FormData) {
  const ctx = await getAccountContext();
  if (!ctx) throw new Error("Unauthorized");
  const canManage = await hasPermission("billing.settings.manage") || await hasPermission("billing.ratecard.manage");
  if (!canManage) {
    throw new Error("Forbidden: billing.settings.manage permission required to edit cost settings");
  }

  const loadedLaborRate = readNonNegative(formData, "loadedLaborRate");
  const aiTokenRate = readNonNegative(formData, "aiTokenRate");
  const ocrPageRate = readNonNegative(formData, "ocrPageRate");
  const aceTransmissionFee = readNonNegative(formData, "aceTransmissionFee");
  const name = String(formData.get("name") || "Default Cost Profile").trim() || "Default Cost Profile";

  const profile = await db.costProfile.create({
    data: {
      accountId: ctx.accountId,
      name,
      loadedLaborRate,
      aiTokenRate,
      ocrPageRate,
      aceTransmissionFee,
      effectiveDate: new Date(),
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "billing.cost_profile.create",
    entity: "CostProfile",
    entityId: profile.id,
    metadata: { name, loadedLaborRate, aiTokenRate, ocrPageRate, aceTransmissionFee },
  });

  revalidatePath("/app/billing/settings");
  revalidatePath("/app/billing");
}
