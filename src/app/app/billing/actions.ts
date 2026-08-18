"use server";

import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { createInvoiceFromCharges } from "@/lib/billing/invoicing";
import { seedBillingEventDefinitions } from "@/lib/billing/telemetry";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireBillingPermission(permission: string | string[]) {
  const context = await getAccountContext();
  if (!context) throw new Error("Unauthorized: Account context required");
  const perms = Array.isArray(permission) ? permission : [permission];
  const checks = await Promise.all(perms.map((p) => hasPermission(p)));
  if (!checks.some(Boolean)) throw new Error(`Forbidden: one of [${perms.join(", ")}] permission required`);
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
  const context = await requireBillingPermission(["billing.ratecard.create", "billing.ratecard.manage"]);
  if (!input.name.trim()) throw new Error("Rate card name is required");
  if (!input.lineItems.length) throw new Error("At least one rate-card line item is required");
  if (input.lineItems.some((item) => !Number.isFinite(item.rate) || item.rate < 0)) throw new Error("Rate-card rates must be valid non-negative numbers");

  const rateCard = await db.$transaction(async (tx) => tx.rateCard.create({
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
  }));

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
  const context = await requireBillingPermission(["billing.mapping.edit", "billing.ratecard.manage"]);
  const uniqueCodes = [...new Set(eventCodes.filter(Boolean))];

  const rule = await db.rateRule.findFirst({
    where: { id: ruleId, rateCardVersion: { rateCard: { accountId: context.accountId } } },
    select: { id: true, lineItemName: true },
  });
  if (!rule) throw new Error("Rate rule not found");

  // Billing event definitions are a platform capability catalog. Rate rules are
  // tenant-owned, but the stable event codes they map to are shared metadata.
  await seedBillingEventDefinitions(context.accountId);
  const definitions = uniqueCodes.length
    ? await db.billingEventDefinition.findMany({
        where: { eventCode: { in: uniqueCodes } },
        select: { id: true, eventCode: true },
      })
    : [];

  if (definitions.length !== uniqueCodes.length) throw new Error("One or more selected billing events are unavailable in the platform catalog");

  await db.$transaction(async (tx) => {
    await tx.rateRuleCapabilityMapping.deleteMany({ where: { rateRuleId: rule.id } });
    if (definitions.length) {
      await tx.rateRuleCapabilityMapping.createMany({
        data: definitions.map((definition) => ({ rateRuleId: rule.id, eventDefId: definition.id })),
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
  const context = await requireBillingPermission(["billing.ratecard.activate", "billing.ratecard.manage"]);
  const card = await db.rateCard.findFirst({
    where: { id: rateCardId, accountId: context.accountId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!card || !card.versions[0]) throw new Error("Rate card not found");
  const version = card.versions[0];
  if (version.status === "ACTIVE" && card.status === "ACTIVE") return { success: true };

  const mappedRuleCount = await db.rateRule.count({ where: { rateCardVersionId: version.id, capabilityMappings: { some: {} } } });
  const ruleCount = await db.rateRule.count({ where: { rateCardVersionId: version.id, isBillable: true } });
  if (ruleCount > 0 && mappedRuleCount === 0) throw new Error("Map at least one billable rate rule to a Qubere billing event before activation");

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

// ── Phase 2: Rate card lifecycle actions ──────────────────────────────────────

/**
 * Clones the latest version's rules into a new DRAFT version. The new version
 * must have its effectiveDate set before it can be activated.
 */
export async function createNewRateCardVersionAction(rateCardId: string, effectiveDate?: string) {
  const context = await requireBillingPermission(["billing.ratecard.create", "billing.ratecard.manage"]);
  const card = await db.rateCard.findFirst({
    where: { id: rateCardId, accountId: context.accountId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: {
          rules: {
            include: { capabilityMappings: { include: { eventDefinition: true } } },
          },
        },
      },
    },
  });
  if (!card) throw new Error("Rate card not found");
  if (card.status === "RETIRED") throw new Error("Cannot create a new version of a retired rate card");
  const latestVersion = card.versions[0];
  if (!latestVersion) throw new Error("Rate card has no existing versions to clone");

  const newVersionNumber = card.currentVersion + 1;
  const effective = effectiveDate ? new Date(`${effectiveDate}T00:00:00`) : new Date();
  if (Number.isNaN(effective.getTime())) throw new Error("Invalid effective date");

  const newVersion = await db.$transaction(async (tx) => {
    const version = await tx.rateCardVersion.create({
      data: {
        rateCardId: card.id,
        version: newVersionNumber,
        effectiveDate: effective,
        status: "DRAFT",
        notes: `Cloned from v${latestVersion.version}`,
        rules: {
          create: latestVersion.rules.map((rule) => ({
            lineItemName: rule.lineItemName,
            serviceCode: rule.serviceCode,
            pricingModel: rule.pricingModel,
            unit: rule.unit,
            rate: rule.rate,
            currency: rule.currency,
            minCharge: rule.minCharge,
            maxCharge: rule.maxCharge,
            includedQuantity: rule.includedQuantity,
            tieredConfig: rule.tieredConfig ?? undefined,
            conditions: rule.conditions ?? undefined,
            isBillable: rule.isBillable,
          })),
        },
      },
      include: { rules: { include: { capabilityMappings: { include: { eventDefinition: true } } } } },
    });

    // Re-create capability mappings for each cloned rule
    for (let i = 0; i < latestVersion.rules.length; i++) {
      const sourceRule = latestVersion.rules[i];
      const newRule = version.rules[i];
      if (!newRule || !sourceRule.capabilityMappings.length) continue;
      await tx.rateRuleCapabilityMapping.createMany({
        data: sourceRule.capabilityMappings.map((m) => ({
          rateRuleId: newRule.id,
          eventDefId: m.eventDefinition.id,
        })),
      });
    }

    await tx.rateCard.update({ where: { id: card.id }, data: { currentVersion: newVersionNumber } });
    return version;
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.ratecard.version.create",
    entity: "RateCard",
    entityId: card.id,
    metadata: { newVersion: newVersionNumber, clonedFrom: latestVersion.version },
  });
  revalidatePath(`/app/billing/rate-cards/${card.id}`);
  return { success: true, versionId: newVersion.id, version: newVersionNumber };
}

/** Updates a line-item rule — only allowed while the version is DRAFT. */
export async function updateDraftRateRuleAction(
  ruleId: string,
  data: {
    lineItemName?: string;
    serviceCode?: string;
    rate?: number;
    unit?: string;
    includedQuantity?: number;
    pricingModel?: string;
    minCharge?: number | null;
    maxCharge?: number | null;
  }
) {
  const context = await requireBillingPermission(["billing.ratecard.edit", "billing.ratecard.manage"]);
  const rule = await db.rateRule.findFirst({
    where: { id: ruleId, rateCardVersion: { rateCard: { accountId: context.accountId } } },
    include: { rateCardVersion: { select: { id: true, status: true, rateCardId: true } } },
  });
  if (!rule) throw new Error("Rate rule not found");
  if (rule.rateCardVersion.status !== "DRAFT") throw new Error("Only DRAFT rate card versions can be edited");
  if (data.rate !== undefined && (!Number.isFinite(data.rate) || data.rate < 0)) throw new Error("Rate must be a valid non-negative number");

  await db.rateRule.update({
    where: { id: ruleId },
    data: {
      ...(data.lineItemName !== undefined && { lineItemName: data.lineItemName }),
      ...(data.serviceCode !== undefined && { serviceCode: data.serviceCode }),
      ...(data.rate !== undefined && { rate: data.rate }),
      ...(data.unit !== undefined && { unit: data.unit }),
      ...(data.includedQuantity !== undefined && { includedQuantity: data.includedQuantity }),
      ...(data.pricingModel !== undefined && { pricingModel: data.pricingModel as any }),
      ...("minCharge" in data && { minCharge: data.minCharge }),
      ...("maxCharge" in data && { maxCharge: data.maxCharge }),
    },
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.rate_rule.update",
    entity: "RateRule",
    entityId: ruleId,
    metadata: { changes: data },
  });
  revalidatePath(`/app/billing/rate-cards/${rule.rateCardVersion.rateCardId}`);
  return { success: true };
}

/** Deletes a line-item rule — only allowed while the version is DRAFT. */
export async function deleteDraftRateRuleAction(ruleId: string) {
  const context = await requireBillingPermission(["billing.ratecard.edit", "billing.ratecard.manage"]);
  const rule = await db.rateRule.findFirst({
    where: { id: ruleId, rateCardVersion: { rateCard: { accountId: context.accountId } } },
    include: { rateCardVersion: { select: { status: true, rateCardId: true } } },
  });
  if (!rule) throw new Error("Rate rule not found");
  if (rule.rateCardVersion.status !== "DRAFT") throw new Error("Only DRAFT rate card versions can be edited");

  await db.rateRule.delete({ where: { id: ruleId } });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.rate_rule.delete",
    entity: "RateRule",
    entityId: ruleId,
    metadata: { lineItemName: rule.lineItemName },
  });
  revalidatePath(`/app/billing/rate-cards/${rule.rateCardVersion.rateCardId}`);
  return { success: true };
}

/** Adds a new line-item rule to a DRAFT version. */
export async function addDraftRateRuleAction(
  rateCardVersionId: string,
  data: {
    lineItemName: string;
    serviceCode: string;
    pricingModel: string;
    unit: string;
    rate: number;
    includedQuantity?: number;
    currency?: string;
  }
) {
  const context = await requireBillingPermission(["billing.ratecard.edit", "billing.ratecard.manage"]);
  if (!data.lineItemName.trim()) throw new Error("Line item name is required");
  if (!Number.isFinite(data.rate) || data.rate < 0) throw new Error("Rate must be a valid non-negative number");

  const version = await db.rateCardVersion.findFirst({
    where: { id: rateCardVersionId, rateCard: { accountId: context.accountId } },
    include: { rateCard: { select: { id: true, currency: true } } },
  });
  if (!version) throw new Error("Rate card version not found");
  if (version.status !== "DRAFT") throw new Error("Only DRAFT rate card versions can be edited");

  const rule = await db.rateRule.create({
    data: {
      rateCardVersionId,
      lineItemName: data.lineItemName.trim(),
      serviceCode: data.serviceCode.trim(),
      pricingModel: data.pricingModel as any,
      unit: data.unit,
      rate: data.rate,
      currency: data.currency ?? version.rateCard.currency,
      includedQuantity: data.includedQuantity ?? 0,
      isBillable: true,
    },
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.rate_rule.create",
    entity: "RateRule",
    entityId: rule.id,
    metadata: { lineItemName: rule.lineItemName, rateCardVersionId },
  });
  revalidatePath(`/app/billing/rate-cards/${version.rateCard.id}`);
  return { success: true, ruleId: rule.id };
}

/** Retires a rate card — safe by construction; resolveActiveRateCardVersion filters on status: "ACTIVE". */
export async function retireRateCardAction(rateCardId: string) {
  const context = await requireBillingPermission(["billing.ratecard.retire", "billing.ratecard.manage"]);
  const card = await db.rateCard.findFirst({
    where: { id: rateCardId, accountId: context.accountId },
    select: { id: true, name: true, status: true },
  });
  if (!card) throw new Error("Rate card not found");
  if (card.status === "RETIRED") return { success: true };

  await db.rateCard.update({ where: { id: rateCardId }, data: { status: "RETIRED" } });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.ratecard.retire",
    entity: "RateCard",
    entityId: card.id,
    metadata: { name: card.name, previousStatus: card.status },
  });
  revalidatePath("/app/billing/rate-cards");
  revalidatePath(`/app/billing/rate-cards/${card.id}`);
  return { success: true };
}

/**
 * Duplicates a rate card (rules + mappings) into a new DRAFT card,
 * optionally re-scoped to a different client/importer.
 */
export async function duplicateRateCardAction(
  rateCardId: string,
  opts: { targetClientId?: string; targetImporterId?: string; newName?: string } = {}
) {
  const context = await requireBillingPermission(["billing.ratecard.create", "billing.ratecard.manage"]);
  const source = await db.rateCard.findFirst({
    where: { id: rateCardId, accountId: context.accountId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { rules: { include: { capabilityMappings: { include: { eventDefinition: true } } } } },
      },
    },
  });
  if (!source) throw new Error("Rate card not found");
  const sourceVersion = source.versions[0];
  if (!sourceVersion) throw new Error("Source rate card has no versions to copy");

  const newName = opts.newName ?? `${source.name} (copy)`;
  const newCard = await db.$transaction(async (tx) => {
    const card = await tx.rateCard.create({
      data: {
        accountId: context.accountId,
        clientId: opts.targetClientId ?? source.clientId,
        importerId: opts.targetImporterId ?? source.importerId,
        name: newName,
        code: null,
        description: source.description,
        currency: source.currency,
        isDefault: false,
        currentVersion: 1,
        status: "DRAFT",
        versions: {
          create: [{
            version: 1,
            effectiveDate: new Date(),
            status: "DRAFT",
            notes: `Duplicated from "${source.name}" v${sourceVersion.version}`,
            rules: {
              create: sourceVersion.rules.map((rule) => ({
                lineItemName: rule.lineItemName,
                serviceCode: rule.serviceCode,
                pricingModel: rule.pricingModel,
                unit: rule.unit,
                rate: rule.rate,
                currency: rule.currency,
                minCharge: rule.minCharge,
                maxCharge: rule.maxCharge,
                includedQuantity: rule.includedQuantity,
                tieredConfig: rule.tieredConfig ?? undefined,
                conditions: rule.conditions ?? undefined,
                isBillable: rule.isBillable,
              })),
            },
          }],
        },
      },
      include: { versions: { include: { rules: true } } },
    });

    // Re-create capability mappings
    const newRules = card.versions[0]?.rules ?? [];
    for (let i = 0; i < sourceVersion.rules.length; i++) {
      const sourceRule = sourceVersion.rules[i];
      const newRule = newRules[i];
      if (!newRule || !sourceRule.capabilityMappings.length) continue;
      await tx.rateRuleCapabilityMapping.createMany({
        data: sourceRule.capabilityMappings.map((m) => ({
          rateRuleId: newRule.id,
          eventDefId: m.eventDefinition.id,
        })),
      });
    }
    return card;
  });

  await createAuditLog({
    accountId: context.accountId,
    userId: context.userId,
    action: "billing.ratecard.duplicate",
    entity: "RateCard",
    entityId: newCard.id,
    metadata: { sourceRateCardId: rateCardId, newName, targetClientId: opts.targetClientId, targetImporterId: opts.targetImporterId },
  });
  revalidatePath("/app/billing/rate-cards");
  return { success: true, rateCardId: newCard.id };
}

export async function createInvoiceAction(formData: FormData) {
  const context = await requireBillingPermission(["billing.invoice.create", "billing.invoice.manage"]);
  const chargeIds = formData.getAll("chargeIds").map(String).filter(Boolean);
  if (!chargeIds.length) throw new Error("Select at least one charge");

  const charges = await db.shipmentCharge.findMany({
    where: { id: { in: chargeIds }, accountId: context.accountId, status: "RATED", invoiceLineId: null },
    include: { shipment: { select: { clientId: true, importerOfRecordId: true } } },
  });
  if (charges.length !== new Set(chargeIds).size) throw new Error("One or more selected charges are unavailable or already invoiced");

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
