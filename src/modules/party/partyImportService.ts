/**
 * CSV import: preview and commit.
 *
 * Mirrors `productImportService.ts`: the flow is upload → preview → commit,
 * both server steps run the same pure validator over the same bytes, and the
 * commit refuses to run unless the digest matches what preview reported.
 *
 * Idempotency is by identity, not by a token. Before creating anything, each
 * row is put through the same deterministic matcher the rest of the party
 * master uses:
 *
 *   NO_MATCH        the row is new; a party is created.
 *   EXACT_MATCH     the party already exists; the row is skipped and
 *                   reported as already present.
 *   POSSIBLE_MATCH  the evidence is suggestive but not conclusive; nothing is
 *   or AMBIGUOUS    written and the row is reported for a person to resolve.
 *
 * The last case is the point of running the matcher at all: an importer that
 * guesses on an ambiguous row either creates a duplicate party or silently
 * treats two different counterparties as one, and the spec's "never merge
 * ambiguous parties automatically" rule applies here exactly as it does to a
 * person editing a party by hand.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { DomainError } from "@/lib/api/error";
import {
  parseCsv,
  validateImport,
  hasCsvExtension,
  type ImportPartyRow,
  type ImportRowError,
  type ImportRowResult,
  CsvParseError,
} from "./partyCsv";
import { createParty, findPartyMatches, type PartyActor } from "./partyService";
import type { CreatePartyInput } from "./partySchemas";

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
  legalName: string | null;
  internalPartyCode: string | null;
  /** The party this row would attach to, when one was matched. */
  matchedPartyId: string | null;
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
      throw new DomainError(error.message, "PARTY_IMPORT_UNREADABLE", 400);
    }
    throw error;
  }
}

/**
 * Validates a file and works out what committing it would do, without
 * writing. Matching runs per row against the live party master, which is why
 * the preview can say "already present" rather than only "valid".
 */
export async function previewImport(
  actor: PartyActor,
  content: string,
  fileName: string | null
): Promise<ImportPreview> {
  const counts = emptyCounts();

  if (fileName !== null && !hasCsvExtension(fileName)) {
    return {
      contentDigest: digestContent(content),
      fileName,
      totalRows: 0,
      counts,
      rows: [],
      unmappedHeaders: [],
      fileErrors: [{ column: null, message: "Please upload a CSV file (.csv)." }],
    };
  }

  const parsed = parseOrThrow(content);
  const validation = validateImport(parsed);

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
async function classifyRow(actor: PartyActor, row: ImportRowResult): Promise<ImportPreviewRow> {
  if (row.status === "INVALID" || row.data === null) {
    return {
      rowNumber: row.rowNumber,
      outcome: "INVALID",
      legalName: null,
      internalPartyCode: null,
      matchedPartyId: null,
      matchExplanation: null,
      errors: row.errors,
      warnings: row.warnings,
    };
  }

  const country = row.data.registration?.country ?? row.data.address?.country ?? null;
  const match = await findPartyMatches(actor, {
    identifiers: row.data.identifiers,
    registrationNumber: row.data.registration?.registrationNumber ?? null,
    registrationCountry: row.data.registration?.country ?? null,
    legalName: row.data.legalName,
    country,
  });

  const first = match.candidates[0] ?? null;

  const outcome: ImportRowOutcome =
    match.status === "EXACT_MATCH" ? "ALREADY_PRESENT" : match.status === "NO_MATCH" ? "CREATED" : "NEEDS_REVIEW";

  return {
    rowNumber: row.rowNumber,
    outcome,
    legalName: row.data.legalName,
    internalPartyCode: row.data.internalPartyCode,
    matchedPartyId: outcome === "CREATED" ? null : (first?.partyId ?? null),
    matchExplanation: first?.explanation ?? null,
    errors: [],
    warnings: row.warnings,
  };
}

export interface ImportCommitResult {
  contentDigest: string;
  counts: Record<ImportRowOutcome, number>;
  rows: readonly ImportPreviewRow[];
  createdPartyIds: readonly string[];
}

/**
 * Applies the file.
 *
 * Each row is written through `createParty`, which runs its own transaction,
 * so one row failing on a constraint the validator could not see leaves
 * every other row committed rather than rolling back the whole file.
 */
export async function commitImport(
  actor: PartyActor,
  content: string,
  fileName: string | null,
  expectedDigest: string,
  acceptedRows: readonly number[] | undefined
): Promise<ImportCommitResult> {
  const contentDigest = digestContent(content);
  if (contentDigest !== expectedDigest) {
    throw new DomainError(
      "The file has changed since it was previewed. Preview it again and check the rows before committing.",
      "PARTY_IMPORT_DIGEST_MISMATCH",
      409
    );
  }

  if (fileName !== null && !hasCsvExtension(fileName)) {
    throw new DomainError("Please upload a CSV file (.csv).", "PARTY_IMPORT_INVALID_FILE", 400);
  }

  const parsed = parseOrThrow(content);
  const validation = validateImport(parsed);
  if (validation.fileErrors.length > 0) {
    throw new DomainError(
      validation.fileErrors.map((error) => error.message).join(" "),
      "PARTY_IMPORT_INVALID_FILE",
      400
    );
  }

  const selected = acceptedRows === undefined ? null : new Set(acceptedRows);
  const counts = emptyCounts();
  const rows: ImportPreviewRow[] = [];
  const createdPartyIds: string[] = [];

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
      const created = await createParty(actor, toCreateInput(row.data));
      createdPartyIds.push(created.id);
      counts.CREATED += 1;
      rows.push({ ...planned, matchedPartyId: created.id });
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
    action: AuditAction.PARTY_IMPORTED,
    entity: "Party",
    entityId: contentDigest,
    source: "UI",
    metadata: {
      fileName,
      contentDigest,
      counts,
      // Row *contents* are deliberately absent: an import file carries
      // counterparty detail, and the audit log is not the place to duplicate it.
      rowCount: validation.rows.length,
    },
    requestId: actor.requestId ?? null,
  });

  return { contentDigest, counts, rows, createdPartyIds };
}

function skeleton(row: ImportRowResult, outcome: ImportRowOutcome): ImportPreviewRow {
  return {
    rowNumber: row.rowNumber,
    outcome,
    legalName: row.data?.legalName ?? null,
    internalPartyCode: row.data?.internalPartyCode ?? null,
    matchedPartyId: null,
    matchExplanation: null,
    errors: row.errors,
    warnings: row.warnings,
  };
}

function toCreateInput(row: ImportPartyRow): CreatePartyInput {
  return {
    partyKind: row.partyKind,
    internalPartyCode: row.internalPartyCode,
    names: [
      { nameType: "LEGAL" as const, rawName: row.legalName, isPrimary: true, sourceType: "IMPORT" as const },
      ...(row.tradeName === null
        ? []
        : [{ nameType: "TRADE" as const, rawName: row.tradeName, isPrimary: false, sourceType: "IMPORT" as const }]),
    ],
    identifiers: row.identifiers.map((identifier) => ({
      identifierType: identifier.identifierType,
      value: identifier.value,
      isPrimary: false,
      sourceType: "IMPORT" as const,
    })),
    registrations:
      row.registration === null
        ? []
        : [
            {
              registrationNumber: row.registration.registrationNumber,
              registeringAuthority: row.registration.registeringAuthority,
              country: row.registration.country,
              legalForm: row.registration.legalForm,
              sourceType: "IMPORT" as const,
            },
          ],
    addresses:
      row.address === null
        ? []
        : [
            {
              addressType: "REGISTERED" as const,
              addressLine1: row.address.addressLine1,
              addressLine2: row.address.addressLine2,
              city: row.address.city,
              stateProvince: row.address.stateProvince,
              postalCode: row.address.postalCode,
              country: row.address.country,
              isPrimary: true,
              sourceType: "IMPORT" as const,
            },
          ],
    contacts:
      row.contact === null
        ? []
        : [
            {
              name: row.contact.name,
              email: row.contact.email,
              phone: row.contact.phone,
              isPrimary: true,
              sourceType: "IMPORT" as const,
            },
          ],
    roles: row.roleTypes.map((roleType) => ({ roleType, sourceType: "IMPORT" as const })),
  };
}

/** Parties that already exist in this account, for the import screen. */
export async function countParties(actor: PartyActor): Promise<number> {
  return db.party.count({ where: { accountId: actor.accountId, deletedAt: null } });
}

export interface BulkCreatePartyItemResult {
  index: number;
  outcome: ImportRowOutcome;
  partyId: string | null;
  matchExplanation: string | null;
  error: string | null;
}

export interface BulkCreatePartyResult {
  counts: Record<ImportRowOutcome, number>;
  results: readonly BulkCreatePartyItemResult[];
  createdPartyIds: readonly string[];
}

/**
 * Creates parties straight from JSON — the machine-integration counterpart to
 * the CSV importer, for a caller that already has structured records rather
 * than a spreadsheet. Each item is put through the same matcher a CSV row
 * goes through before anything is written: an `EXACT_MATCH` is reported
 * `ALREADY_PRESENT` and left alone, a `POSSIBLE_MATCH`/`AMBIGUOUS` is reported
 * `NEEDS_REVIEW` and left alone, and only `NO_MATCH` items are created. This
 * is insert-only — an item that matches an existing party is never used to
 * update it, so a caller cannot use this path to silently overwrite a fact a
 * person already reviewed.
 *
 * One item failing on a constraint the schema could not see (e.g. a race on
 * `internalPartyCode`) is reported as that item's own `FAILED` outcome; it
 * does not abort the rest of the batch.
 */
export async function bulkCreateParties(
  actor: PartyActor,
  items: readonly CreatePartyInput[]
): Promise<BulkCreatePartyResult> {
  const counts = emptyCounts();
  const results: BulkCreatePartyItemResult[] = [];
  const createdPartyIds: string[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const legalName = item.names.find((name) => name.nameType === "LEGAL")?.rawName ?? item.names[0]!.rawName;
    const registration = item.registrations?.[0] ?? null;
    const address = item.addresses?.[0] ?? null;
    const country = registration?.country ?? address?.country ?? null;

    const match = await findPartyMatches(actor, {
      identifiers: (item.identifiers ?? []).map((identifier) => ({
        identifierType: identifier.identifierType,
        value: identifier.value,
        issuingCountry: identifier.issuingCountry ?? null,
      })),
      registrationNumber: registration?.registrationNumber ?? null,
      registrationCountry: registration?.country ?? null,
      legalName,
      country,
    });

    if (match.status !== "NO_MATCH") {
      const outcome: ImportRowOutcome = match.status === "EXACT_MATCH" ? "ALREADY_PRESENT" : "NEEDS_REVIEW";
      const first = match.candidates[0] ?? null;
      counts[outcome] += 1;
      results.push({
        index,
        outcome,
        partyId: outcome === "ALREADY_PRESENT" ? (first?.partyId ?? null) : null,
        matchExplanation: first?.explanation ?? null,
        error: null,
      });
      continue;
    }

    try {
      const created = await createParty(actor, item);
      createdPartyIds.push(created.id);
      counts.CREATED += 1;
      results.push({ index, outcome: "CREATED", partyId: created.id, matchExplanation: null, error: null });
    } catch (error) {
      counts.FAILED += 1;
      results.push({
        index,
        outcome: "FAILED",
        partyId: null,
        matchExplanation: null,
        error: error instanceof Error ? error.message : "The item could not be written.",
      });
    }
  }

  await createAuditLog({
    accountId: actor.accountId,
    userId: actor.userId,
    action: AuditAction.PARTY_IMPORTED,
    entity: "Party",
    entityId: actor.requestId ?? "bulk-create",
    source: "UI",
    metadata: {
      counts,
      itemCount: items.length,
      // Item *contents* are deliberately absent, matching the CSV import audit
      // entry: this carries counterparty detail, not something to duplicate here.
    },
    requestId: actor.requestId ?? null,
  });

  return { counts, results, createdPartyIds };
}
