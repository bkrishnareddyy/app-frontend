"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function adjustShipmentChargeAction(chargeId: string, formData: FormData) {
  const ctx = await getAccountContext();
  if (!ctx) throw new Error("Unauthorized");
  if (!(await hasPermission("billing.charge.adjust"))) {
    throw new Error("Forbidden: billing.charge.adjust permission required");
  }

  const adjustmentType = String(formData.get("adjustmentType") || "DISCOUNT").toUpperCase();
  const reason = String(formData.get("reason") || "").trim();
  const rawAmount = Number(formData.get("amount"));
  if (!reason) throw new Error("Adjustment reason is required");
  if (!Number.isFinite(rawAmount) || rawAmount < 0) throw new Error("Adjustment amount must be a non-negative number");
  if (!["DISCOUNT", "CREDIT", "WAIVER"].includes(adjustmentType)) throw new Error("Unsupported adjustment type");

  const charge = await db.shipmentCharge.findFirst({
    where: { id: chargeId, accountId: ctx.accountId },
  });
  if (!charge) throw new Error("Charge not found");
  if (charge.invoiceLineId || charge.status === "INVOICED") {
    throw new Error("Invoiced charges are immutable. Create an invoice credit/reversal instead.");
  }
  if (["VOIDED", "REVERSED"].includes(charge.status)) throw new Error("This charge cannot be adjusted");

  const currentNet = Number(charge.netAmount);
  const gross = Number(charge.grossAmount);
  const adjustmentAmount = adjustmentType === "WAIVER" ? currentNet : rawAmount;
  if (adjustmentAmount > currentNet) throw new Error("Discount or credit cannot exceed the current billable amount");

  const discountPct = gross > 0 ? (adjustmentAmount / gross) * 100 : 0;
  const requiresAdminApproval = adjustmentType === "WAIVER" || discountPct > 10;
  if (requiresAdminApproval && !(await hasPermission("billing.ratecard.manage"))) {
    throw new Error("Billing Admin approval is required for waivers or discounts greater than 10%");
  }

  const newNet = Math.max(0, currentNet - adjustmentAmount);
  const newDiscountTotal = Math.max(0, gross - newNet);

  const adjustment = await db.$transaction(async (tx) => {
    const created = await tx.chargeAdjustment.create({
      data: {
        chargeId: charge.id,
        adjustmentType,
        originalAmount: new Prisma.Decimal(currentNet),
        adjustmentAmount: new Prisma.Decimal(-adjustmentAmount),
        newAmount: new Prisma.Decimal(newNet),
        reason,
        requestedById: ctx.userId,
        approvedById: requiresAdminApproval ? ctx.userId : null,
        approvalStatus: "APPROVED",
      },
    });

    await tx.shipmentCharge.update({
      where: { id: charge.id },
      data: {
        discountAmount: new Prisma.Decimal(newDiscountTotal),
        netAmount: new Prisma.Decimal(newNet),
      },
    });
    return created;
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "billing.charge.adjust",
    entity: "ShipmentCharge",
    entityId: charge.id,
    metadata: {
      adjustmentId: adjustment.id,
      adjustmentType,
      originalAmount: currentNet,
      adjustmentAmount: -adjustmentAmount,
      newAmount: newNet,
      reason,
      adminApprovalRequired: requiresAdminApproval,
    },
  });

  revalidatePath(`/app/billing/charges/${charge.id}`);
  revalidatePath("/app/billing/usage");
  revalidatePath("/app/billing/shipments");
  revalidatePath("/app/billing");
}
