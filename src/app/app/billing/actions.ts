"use server";

import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { createInvoiceFromCharges } from "@/lib/billing/invoicing";
import { seedBillingEventDefinitions } from "@/lib/billing/telemetry";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireBillingPermission(permission: string) {
  const context = await getAccountContext();
  if (!context) throw new Error("Unauthorized: Account context required");
  if (!(await hasPermission(permission))) {
    throw new Error(`Forbidden: ${permission} permission required`);
  }
  return context;
}

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
  const context = await requireBillingPermission("billing.ratecard.manage");

  if (!input.name.trim()) throw new Error("Rate card name is required");
  if (!input.lineItems.length) throw new Error("At least one rate-card line item is required");
  if (input.lineItems.some((item) => !Number.isFinite(item.rate) || item.rate < 0)) {
    throw new Error("Rate-card rates must be valid non-negative numbers");
  }

  const rateCard = await db.$transaction(async (tx) => {
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

export async function saveRateRuleMappingsAction(ruleId: string, eventCodes: string[]) {
  const context = await requireBillingPermission("billing.ratecard.manage");
  const uniqueCodes = [...new Set(eventCodes.filter(Boolean))];

  const rule = await db.rateRule.findFirst({
    where: {
      id: ruleId,
      rateCardVersion: { rateCard: { accountId: context.accountId } },
    },
    select: { id: true, lineItemName: true },
  });
  if (!rule) throw new Error("Rate rule not found");

  await seedBillingEventDefinitions(context.accountId);
  const definitions = uniqueCodes.length
    ? await db.billingEventDefinition.findMany({
        where: { accountId: context.accountId, eventCode: { in: uniqueCodes } },
        select: { id: true, eventCode: true },
      })
    : [];

  if (definitions.length !== uniqueCodes.length) {
    throw new Error("One or more selected billing events are unavailable for this account");
  }

  await db.$transaction(async (tx) => {
    await tx.rateRuleCapabilityMapping.deleteMany({ where: { rateRuleId: rule.id } });
    if (definitions.length) {
      await tx.rateRuleCapabilityMapping.createMany({
        data: definitions.map((definition) => ({
          rateRuleId: rule.id,
          eventDefId: definition.id,
        })),
      });
    }
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.rate_rule.mapping.update",
    entity: "RateRule",
    entityId: rule.id,
    metadata: { eventCodes: uniqueCodes },
  });

  revalidatePath("/app/billing/rate-cards");
  return { success: true };
}

export async function activateRateCardAction(rateCardId: string) {
  const context = await requireBillingPermission("billing.ratecard.manage");

  const card = await db.rateCard.findFirst({
    where: { id: rateCardId, accountId: context.accountId },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!card || !card.versions[0]) throw new Error("Rate card not found");
  const version = card.versions[0];
  if (version.status === "ACTIVE" && card.status === "ACTIVE") return { success: true };

  const mappedRuleCount = await db.rateRule.count({
    where: {
      rateCardVersionId: version.id,
      capabilityMappings: { some: {} },
    },
  });
  const ruleCount = await db.rateRule.count({ where: { rateCardVersionId: version.id, isBillable: true } });
  if (ruleCount > 0 && mappedRuleCount === 0) {
    throw new Error("Map at least one billable rate rule to a Qubere billing event before activation");
  }

  await db.$transaction(async (tx) => {
    if (card.isDefault) {
      await tx.rateCard.updateMany({
        where: { accountId: context.accountId, isDefault: true, status: "ACTIVE", id: { not: card.id } },
        data: { isDefault: false },
      });
    }
    await tx.rateCardVersion.update({
      where: { id: version.id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedById: context.userId },
    });
    await tx.rateCard.update({ where: { id: card.id }, data: { status: "ACTIVE" } });
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.ratecard.activate",
    entity: "RateCard",
    entityId: card.id,
    metadata: { version: version.version },
  });

  revalidatePath("/app/billing/rate-cards");
  revalidatePath(`/app/billing/rate-cards/${card.id}`);
  return { success: true };
}

export async function createInvoiceAction(formData: FormData) {
  const context = await requireBillingPermission("billing.invoice.manage");
  const chargeIds = formData.getAll("chargeIds").map(String).filter(Boolean);
  if (!chargeIds.length) throw new Error("Select at least one charge");

  const charges = await db.shipmentCharge.findMany({
    where: {
      id: { in: chargeIds },
      accountId: context.accountId,
      status: "RATED",
      invoiceLineId: null,
    },
    include: { shipment: { select: { clientId: true, importerOfRecordId: true } } },
  });
  if (charges.length !== new Set(chargeIds).size) {
    throw new Error("One or more selected charges are unavailable or already invoiced");
  }

  const clientIds = [...new Set(charges.map((c) => c.shipment.clientId).filter((v): v is string => Boolean(v)))];
  if (clientIds.length !== 1) throw new Error("An invoice must contain charges for exactly one client");

  const importerIds = [...new Set(charges.map((c) => c.shipment.importerOfRecordId).filter((v): v is string => Boolean(v)))];
  if (importerIds.length > 1) throw new Error("Selected charges span multiple importer accounts; create separate invoices");

  const dueDateRaw = String(formData.get("dueDate") || "");
  const dueDate = dueDateRaw ? new Date(`${dueDateRaw}T12:00:00`) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(dueDate.getTime())) throw new Error("Invalid invoice due date");

  const invoice = await createInvoiceFromCharges({
    accountId: context.accountId,
    clientId: clientIds[0],
    importerId: importerIds[0],
    dueDate,
    chargeIds,
    notes: String(formData.get("notes") || "") || undefined,
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.invoice.create",
    entity: "Invoice",
    entityId: invoice.id,
    metadata: { invoiceNumber: invoice.invoiceNumber, chargeCount: chargeIds.length },
  });

  revalidatePath("/app/billing/invoices");
  redirect("/app/billing/invoices");
}
