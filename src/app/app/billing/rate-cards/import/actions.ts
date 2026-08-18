"use server";

import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { getAccountContext, hasPermission } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { seedBillingEventDefinitions } from "@/lib/billing/telemetry";
import { revalidatePath } from "next/cache";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 250;

async function requireRateCardAdmin() {
  const ctx = await getAccountContext();
  if (!ctx) throw new Error("Unauthorized: Account context required");
  if (!(await hasPermission("billing.ratecard.manage"))) throw new Error("Forbidden: billing.ratecard.manage permission required");
  return ctx;
}

export async function parseRateCardUploadAction(formData: FormData) {
  await requireRateCardAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a rate-card file to upload");
  if (file.size === 0) throw new Error("The uploaded rate-card file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Rate-card uploads are limited to 5 MB");

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".csv")) throw new Error("CSV import is supported now. XLSX requires the spreadsheet parser dependency and is not enabled yet.");

  const text = await file.text();
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Record<string, string>[];
  if (!records.length) throw new Error("No data rows were found in the uploaded CSV");
  const headers = Object.keys(records[0] ?? {}).filter(Boolean);
  if (!headers.length) throw new Error("The uploaded CSV does not contain a header row");

  return {
    fileName: file.name,
    headers,
    rowCount: records.length,
    rows: records.slice(0, MAX_PREVIEW_ROWS).map((row) => Object.fromEntries(headers.map((header) => [header, String(row[header] ?? "")]))),
    truncated: records.length > MAX_PREVIEW_ROWS,
  };
}

export interface ImportedRateCardLine {
  lineItemName: string;
  serviceCode: string;
  pricingModel: string;
  unit: string;
  rate: number;
  includedQuantity?: number;
  eventCode: string;
}

export async function createImportedRateCardAction(input: {
  name: string;
  currency?: string;
  description?: string;
  isDefault?: boolean;
  clientId?: string;
  importerId?: string;
  lines: ImportedRateCardLine[];
}) {
  const ctx = await requireRateCardAdmin();
  if (!input.name.trim()) throw new Error("Rate card name is required");
  if (!input.lines.length) throw new Error("At least one imported rate-card line is required");
  if (input.lines.some((line) => !line.lineItemName.trim() || !line.eventCode)) throw new Error("Every imported line must have a description and mapped billing event");
  if (input.lines.some((line) => !Number.isFinite(line.rate) || line.rate < 0)) throw new Error("Imported rates must be valid non-negative numbers");

  await seedBillingEventDefinitions(ctx.accountId);
  const eventCodes = [...new Set(input.lines.map((line) => line.eventCode))];
  const definitions = await db.billingEventDefinition.findMany({
    where: { eventCode: { in: eventCodes } },
    select: { id: true, eventCode: true },
  });
  const definitionByCode = new Map(definitions.map((definition) => [definition.eventCode, definition.id]));
  const missing = eventCodes.filter((code) => !definitionByCode.has(code));
  if (missing.length) throw new Error(`Billing event definitions unavailable in the platform catalog: ${missing.join(", ")}`);

  const rateCard = await db.rateCard.create({
    data: {
      accountId: ctx.accountId,
      clientId: input.clientId || null,
      importerId: input.importerId || null,
      name: input.name.trim(),
      description: input.description || "Imported customer rate card",
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
            create: input.lines.map((line) => ({
              lineItemName: line.lineItemName.trim(),
              serviceCode: line.serviceCode.trim() || line.eventCode,
              pricingModel: line.pricingModel as any,
              unit: line.unit.trim() || "unit",
              rate: line.rate,
              currency: input.currency || "USD",
              includedQuantity: Math.max(0, Math.floor(line.includedQuantity ?? 0)),
              isBillable: true,
              capabilityMappings: { create: [{ eventDefId: definitionByCode.get(line.eventCode)! }] },
            })),
          },
        }],
      },
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "billing.ratecard.import",
    entity: "RateCard",
    entityId: rateCard.id,
    metadata: { lineCount: input.lines.length, status: "DRAFT", eventCodes },
  });

  revalidatePath("/app/billing/rate-cards");
  return { success: true, rateCardId: rateCard.id };
}
