"use server";

import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
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
  const canUpload = await hasPermission("billing.ratecard.upload") || await hasPermission("billing.ratecard.manage");
  if (!canUpload) throw new Error("Forbidden: billing.ratecard.upload permission required");
  return ctx;
}

/** Parses the first sheet of an XLSX/XLS file into { headers, rows } matching the CSV output shape. */
async function parseXlsxFile(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[]; rowCount: number }> {
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error @types/node v20 adds a generic to Buffer that predates exceljs types
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The uploaded spreadsheet contains no worksheets");

  const allRows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = (row.values as Array<ExcelJS.CellValue>).slice(1); // ExcelJS row.values is 1-indexed with a leading null
    allRows.push(
      cells.map((cell) => {
        if (cell == null) return "";
        // Dates — convert to ISO string to avoid number auto-coercion
        if (cell instanceof Date) return cell.toISOString().split("T")[0];
        if (typeof cell === "object" && "result" in cell) return String((cell as { result: unknown }).result ?? "");
        if (typeof cell === "object" && "richText" in cell) return (cell as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
        return String(cell);
      })
    );
  });

  if (!allRows.length) throw new Error("No rows found in the first worksheet");
  const headers = (allRows[0] ?? []).map((h) => h.trim()).filter(Boolean);
  if (!headers.length) throw new Error("The spreadsheet does not have a header row in the first row");

  const dataRows = allRows.slice(1);
  const rows = dataRows.map((row) =>
    Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""]))
  );

  return { headers, rows, rowCount: rows.length };
}

export async function parseRateCardUploadAction(formData: FormData) {
  await requireRateCardAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a rate-card file to upload");
  if (file.size === 0) throw new Error("The uploaded rate-card file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Rate-card uploads are limited to 5 MB");

  const lowerName = file.name.toLowerCase();
  const isXlsx = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");

  let headers: string[];
  let rows: Record<string, string>[];
  let rowCount: number;

  if (isXlsx) {
    const arrayBuffer = await file.arrayBuffer();
    const parsed = await parseXlsxFile(Buffer.from(arrayBuffer));
    headers = parsed.headers;
    rows = parsed.rows;
    rowCount = parsed.rowCount;
  } else if (lowerName.endsWith(".csv")) {
    const text = await file.text();
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Record<string, string>[];
    if (!records.length) throw new Error("No data rows were found in the uploaded CSV");
    headers = Object.keys(records[0] ?? {}).filter(Boolean);
    if (!headers.length) throw new Error("The uploaded CSV does not contain a header row");
    rows = records;
    rowCount = records.length;
  } else {
    throw new Error("Only .csv, .xlsx, and .xls files are supported for rate card import");
  }

  if (!rowCount) throw new Error("No data rows were found in the uploaded file");

  return {
    fileName: file.name,
    headers,
    rowCount,
    rows: rows.slice(0, MAX_PREVIEW_ROWS).map((row) => Object.fromEntries(headers.map((header) => [header, String(row[header] ?? "")]))),
    truncated: rowCount > MAX_PREVIEW_ROWS,
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
