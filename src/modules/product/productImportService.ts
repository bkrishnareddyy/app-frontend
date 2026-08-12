/**
 * CSV import: preview and commit.
 *
 * The flow is upload → preview → commit, and the two server steps run the same
 * pure validator over the same bytes. The commit re-derives everything from the
 * file rather than trusting a stashed preview, and refuses to run unless the
 * digest matches what preview reported — so what a user approved is provably
 * what gets written, without a staging table that could go stale.
 *
 * Idempotency is by identity, not by a token. Before creating anything, each row
 * is put through the same deterministic matcher the rest of the system uses:
 *
 *   NO_MATCH        the row is new; a product is created.
 *   EXACT_MATCH     the product already exists; the row is skipped and reported
 *                   as already present. Re-uploading yesterday's file therefore
 *                   creates nothing.
 *   POSSIBLE_MATCH  the evidence is suggestive but not conclusive; nothing is
 *   or AMBIGUOUS    written and the row is reported for a person to resolve.
 *
 * The last case is the one worth defending. An importer that guesses on an
 * ambiguous row either creates a duplicate product or silently merges two real
 * products into one, and both are discovered months later at the wrong moment.
 * Reporting the row costs someone a minute now.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { DomainError } from "@/lib/api/error";
import {
  parseCsv,
  validateImport,
  type ImportProductRow,
  type ImportRowError,
  type ImportRowResult,
  CsvParseError,
} from "./productCsv";
import { createProduct, findProductMatches, proposeClassification, type ProductActor } from "./productService";
import type { CreateProductInput } from "./productSchemas";

export type ImportRowOutcome =
  | "CREATED"
  | "ALREADY_PRESENT"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "NOT_SELECTED"
  | "FAILED";

export interface ImportPreviewRow {
  rowNumber: number;
  outcome: ImportRowOutcome;
  productName: string | null;
  internalSku: string | null;
  /** The product this row would attach to, when one was matched. */
  matchedProductId: string | null;
  matchExplanation: string | null;
  errors: readonly ImportRowError[];
  warnings: readonly ImportRowError[];
}

export interface ImportPreview {
  contentDigest: string;
  fileName: string | null;
  totalRows: number;
  counts: Record<ImportRowOutcome, number>;
  rows: readonly ImportPreviewRow[];
  unmappedHeaders: readonly string[];
  fileErrors: readonly ImportRowError[];
}

export function digestContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function emptyCounts(): Record<ImportRowOutcome, number> {
  return {
    CREATED: 0,
    ALREADY_PRESENT: 0,
    NEEDS_REVIEW: 0,
    INVALID: 0,
    NOT_SELECTED: 0,
    FAILED: 0,
  };
}

function parseOrThrow(content: string) {
  try {
    return parseCsv(content);
  } catch (error) {
    if (error instanceof CsvParseError) {
      throw new DomainError(error.message, "PRODUCT_IMPORT_UNREADABLE", 400);
    }
    throw error;
  }
}

/**
 * Validates a file and works out what committing it would do, without writing.
 *
 * Matching runs per row against the live catalogue, which is why the preview can
 * say "already present" rather than only "valid". The counts it reports are the
 * counts the commit will produce, provided nothing else changes the catalogue in
 * between — and if something does, the commit re-checks each row anyway.
 */
export async function previewImport(
  actor: ProductActor,
  content: string,
  fileName: string | null
): Promise<ImportPreview> {
  const parsed = parseOrThrow(content);
  const validation = validateImport(parsed);
  const counts = emptyCounts();

  if (validation.fileErrors.length > 0) {
    return {
      contentDigest: digestContent(content),
      fileName,
      totalRows: parsed.rows.length,
      counts,
      rows: [],
      unmappedHeaders: validation.mapping.unmappedHeaders,
      fileErrors: validation.fileErrors,
    };
  }

  const rows: ImportPreviewRow[] = [];
  for (const row of validation.rows) {
    const previewRow = await classifyRow(actor, row);
    counts[previewRow.outcome] += 1;
    rows.push(previewRow);
  }

  return {
    contentDigest: digestContent(content),
    fileName,
    totalRows: validation.rows.length,
    counts,
    rows,
    unmappedHeaders: validation.mapping.unmappedHeaders,
    fileErrors: [],
  };
}

/** Decides what would happen to one validated row, without writing anything. */
async function classifyRow(
  actor: ProductActor,
  row: ImportRowResult
): Promise<ImportPreviewRow> {
  if (row.status === "INVALID" || row.data === null) {
    return {
      rowNumber: row.rowNumber,
      outcome: "INVALID",
      productName: null,
      internalSku: null,
      matchedProductId: null,
      matchExplanation: null,
      errors: row.errors,
      warnings: row.warnings,
    };
  }

  const match = await findProductMatches(actor, {
    identifiers: row.data.identifiers,
    productName: row.data.productName,
    brand: row.data.brand,
  });

  const first = match.candidates[0] ?? null;

  const outcome: ImportRowOutcome =
    match.status === "EXACT_MATCH"
      ? "ALREADY_PRESENT"
      : match.status === "NO_MATCH"
        ? "CREATED"
        : "NEEDS_REVIEW";

  return {
    rowNumber: row.rowNumber,
    outcome,
    productName: row.data.productName,
    internalSku: row.data.internalSku,
    matchedProductId: outcome === "CREATED" ? null : (first?.productId ?? null),
    matchExplanation: first?.explanation ?? null,
    errors: [],
    warnings: row.warnings,
  };
}

export interface ImportCommitResult {
  contentDigest: string;
  counts: Record<ImportRowOutcome, number>;
  rows: readonly ImportPreviewRow[];
  createdProductIds: readonly string[];
}

/**
 * Applies the file.
 *
 * Each row is written in its own transaction, by way of `createProduct`, so one
 * row failing on a constraint the validator could not see — a SKU claimed by
 * another user thirty seconds ago — leaves every other row committed. A partial
 * import that reports precisely which rows landed is more useful than an
 * all-or-nothing import that rolls back 3,999 good rows because of one race.
 */
export async function commitImport(
  actor: ProductActor,
  content: string,
  fileName: string | null,
  expectedDigest: string,
  acceptedRows: readonly number[] | undefined
): Promise<ImportCommitResult> {
  const contentDigest = digestContent(content);
  if (contentDigest !== expectedDigest) {
    throw new DomainError(
      "The file has changed since it was previewed. Preview it again and check the rows before committing.",
      "PRODUCT_IMPORT_DIGEST_MISMATCH",
      409
    );
  }

  const parsed = parseOrThrow(content);
  const validation = validateImport(parsed);
  if (validation.fileErrors.length > 0) {
    throw new DomainError(
      validation.fileErrors.map((error) => error.message).join(" "),
      "PRODUCT_IMPORT_INVALID_FILE",
      400
    );
  }

  const selected = acceptedRows === undefined ? null : new Set(acceptedRows);
  const counts = emptyCounts();
  const rows: ImportPreviewRow[] = [];
  const createdProductIds: string[] = [];

  for (const row of validation.rows) {
    if (selected !== null && !selected.has(row.rowNumber)) {
      counts.NOT_SELECTED += 1;
      rows.push(skeleton(row, "NOT_SELECTED"));
      continue;
    }

    const planned = await classifyRow(actor, row);

    if (planned.outcome !== "CREATED" || row.data === null) {
      counts[planned.outcome] += 1;
      rows.push(planned);
      continue;
    }

    try {
      const created = await createProduct(actor, toCreateInput(row.data));
      createdProductIds.push(created.id);

      // Classifications are recorded after the product exists, and always as
      // CANDIDATE: `proposeClassification` derives the status from the method,
      // and the method for an import is IMPORT. A spreadsheet cannot approve a
      // tariff code, whatever a column in it says.
      for (const classification of row.data.classifications) {
        await proposeClassification(actor, created.id, {
          jurisdiction: classification.jurisdiction,
          nomenclature: classification.nomenclature,
          classificationCode: classification.classificationCode,
          description: `Imported from ${fileName ?? "a CSV file"}, row ${row.rowNumber}. Not reviewed.`,
          decisionSource: "IMPORT",
          decisionMethod: "IMPORT",
        });
      }

      counts.CREATED += 1;
      rows.push({ ...planned, matchedProductId: created.id });
    } catch (error) {
      counts.FAILED += 1;
      rows.push({
        ...planned,
        outcome: "FAILED",
        errors: [
          {
            column: null,
            message: error instanceof Error ? error.message : "The row could not be written.",
          },
        ],
      });
    }
  }

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: "product.import.commit",
    entity: "Product",
    entityId: contentDigest,
    metadata: {
      fileName,
      contentDigest,
      counts,
      // Row *contents* are deliberately absent: an import file carries commercial
      // detail, and the audit log is not the place to duplicate it.
      rowCount: validation.rows.length,
    },
    requestId: actor.requestId ?? null,
  });

  return { contentDigest, counts, rows, createdProductIds };
}

function skeleton(row: ImportRowResult, outcome: ImportRowOutcome): ImportPreviewRow {
  return {
    rowNumber: row.rowNumber,
    outcome,
    productName: row.data?.productName ?? null,
    internalSku: row.data?.internalSku ?? null,
    matchedProductId: null,
    matchExplanation: null,
    errors: row.errors,
    warnings: row.warnings,
  };
}

function toCreateInput(row: ImportProductRow): CreateProductInput {
  return {
    productName: row.productName,
    internalSku: row.internalSku,
    commercialDescription: row.commercialDescription,
    technicalDescription: row.technicalDescription,
    customsDescription: row.customsDescription,
    brand: row.brand,
    model: row.model,
    status: "DRAFT",
    identifiers: row.identifiers
      .filter((identifier) => identifier.identifierType !== "INTERNAL_SKU")
      .map((identifier) => ({
        identifierType: identifier.identifierType,
        value: identifier.value,
        sourceType: "IMPORT" as const,
        isPrimary: false,
        issuerPartyId: null,
      })),
    attributes: row.attributes.map((attribute) => ({
      attributeCode: attribute.attributeCode,
      rawValue: attribute.rawValue,
      rawUnit: attribute.rawUnit,
      attributeName: null,
      sourceType: "IMPORT" as const,
      evidenceId: null,
    })),
    compositions: row.compositions.map((composition) => ({
      material: composition.material,
      percentage: composition.percentage,
      isCompleteDeclaration: composition.isCompleteDeclaration,
      componentName: null,
      quantity: null,
      unit: null,
      grade: null,
      alloy: null,
      chemicalIdentifier: null,
      sourceType: "IMPORT" as const,
      evidenceId: null,
    })),
    countryFacts: row.countryFacts.map((fact) => ({
      factType: fact.factType,
      country: fact.rawCountry,
      sourceType: "IMPORT" as const,
      sourceReference: "Imported from a CSV file.",
      evidenceId: null,
    })),
    parties: [],
  };
}

/** Products that were never checked against the catalogue, for the import screen. */
export async function countProducts(actor: ProductActor): Promise<number> {
  return db.product.count({ where: { accountId: actor.accountId, deletedAt: null } });
}
