/**
 * Deterministic, exact-identifier shipment matching for emailed documents.
 *
 * Scope is intentionally narrow: only `Shipment.shipmentNumber` (system-
 * generated, unique per account) and `Shipment.poReference` (free text) are
 * usable match keys today -- there is no container/bill-of-lading field on
 * `Shipment`, and full structured extraction (invoice #, carrier, etc.) does
 * not run until a document is already attached to a shipment. No AI/LLM call
 * is used for matching itself: plain regex extraction of candidate tokens,
 * then an exact (normalized) database lookup. A literal, system-generated
 * shipment number appearing in text is unambiguous; a PO reference is a
 * weaker signal but still exact-string, not fuzzy.
 *
 * Every candidate that resolves to a real shipment is persisted, matched or
 * not -- "why didn't this match?" must always be answerable, and a match is
 * never a silent guess (mirrors `resolveShipment.ts`'s "never guess" stance).
 */

import { db } from "@/lib/db";
import type { NormalizedParserResult } from "@/modules/documents/parser/contracts";

/**
 * Flattens a completed parse's normalized result down to plain text for
 * identifier scanning. Kept out of documentProcessingWorker.ts deliberately:
 * that file is asserted (see tests/document-processing-integrity.test.ts) to
 * never reference the full rendered document content, only identifiers and
 * codes, to keep document contents out of its logs.
 */
export function plainTextFromParsedResult(normalized: NormalizedParserResult): string {
  return normalized.markdown ?? normalized.sections.map((s) => s.content).join("\n");
}

export interface IdentifierCandidates {
  shipmentNumbers: string[];
  poReferences: string[];
}

const SHIPMENT_NUMBER_PATTERN = /\bSHP-\d{4}-\d{6}\b/gi;
// Matches "PO-778899", "P.O. 778899", "PO#778899", etc. -- the whole token,
// not just the digits, so normalization can be format-insensitive without
// losing the "PO" identity of the match.
const PO_REFERENCE_PATTERN = /\bP\.?O\.?[-\s#:]*[A-Z0-9-]{3,20}\b/gi;

function normalizeIdentifier(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function extractIdentifierCandidates(text: string): IdentifierCandidates {
  const shipmentNumbers = Array.from(
    new Set((text.match(SHIPMENT_NUMBER_PATTERN) ?? []).map((v) => v.toUpperCase()))
  );
  const poReferences = Array.from(
    new Set((text.match(PO_REFERENCE_PATTERN) ?? []).map(normalizeIdentifier))
  );
  return { shipmentNumbers, poReferences };
}

export interface ResolvedShipmentRef {
  id: string;
}

export interface CandidateRecord {
  accountId: string;
  documentId: string;
  shipmentId: string;
  matchedIdentifierType: "SHIPMENT_NUMBER" | "PO_REFERENCE";
  matchedValue: string;
  matchedSource: "EMAIL_SUBJECT" | "PARSED_DOCUMENT_TEXT";
  autoSelected: boolean;
  /** E-1: 0.0–1.0 match signal. Exact-identifier matches write 1.0. */
  confidenceScore?: number;
}

export interface ShipmentIdentifierLookup {
  findByShipmentNumber(accountId: string, shipmentNumber: string): Promise<ResolvedShipmentRef | null>;
  /** Case/punctuation-insensitive on the account's shipments (bounded set, in-memory compare). */
  findByPoReference(accountId: string, normalizedPoReference: string): Promise<ResolvedShipmentRef[]>;
  recordCandidate(record: CandidateRecord): Promise<void>;
}

export const databaseShipmentIdentifierLookup: ShipmentIdentifierLookup = {
  async findByShipmentNumber(accountId, shipmentNumber) {
    const row = await db.shipment.findFirst({
      where: { accountId, shipmentNumber, deletedAt: null },
      select: { id: true },
    });
    return row;
  },
  async findByPoReference(accountId, normalizedPoReference) {
    // Shipment.poReference is stored as free text (e.g. "PO-778899"), so
    // exact-equality at the DB level would miss format variance ("P.O.
    // 778899" vs "PO-778899"). Normalizing both sides in JS over the
    // account's own shipments keeps the comparison exact (not fuzzy) while
    // being punctuation-insensitive. Bounded to one account's shipments.
    const shipments = await db.shipment.findMany({
      where: { accountId, poReference: { not: null }, deletedAt: null },
      select: { id: true, poReference: true },
    });
    return shipments
      .filter((s) => s.poReference !== null && normalizeIdentifier(s.poReference) === normalizedPoReference)
      .map((s) => ({ id: s.id }));
  },
  async recordCandidate(record) {
    await db.documentShipmentCandidate.create({
      data: {
        accountId: record.accountId,
        documentId: record.documentId,
        shipmentId: record.shipmentId,
        matchedIdentifierType: record.matchedIdentifierType,
        matchedValue: record.matchedValue,
        matchedSource: record.matchedSource,
        autoSelected: record.autoSelected,
        confidenceScore: record.confidenceScore ?? 1.0,
      },
    });
  },
};

export interface MatchShipmentInput {
  accountId: string;
  documentId: string;
  emailSubject: string | null;
  parsedText: string | null;
}

interface ResolvedCandidate {
  shipmentId: string;
  identifierType: "SHIPMENT_NUMBER" | "PO_REFERENCE";
  value: string;
  source: "EMAIL_SUBJECT" | "PARSED_DOCUMENT_TEXT";
}

async function resolveByShipmentNumber(
  input: MatchShipmentInput,
  lookup: ShipmentIdentifierLookup
): Promise<ResolvedCandidate[]> {
  const resolved: ResolvedCandidate[] = [];
  const sources: Array<[string | null, ResolvedCandidate["source"]]> = [
    [input.emailSubject, "EMAIL_SUBJECT"],
    [input.parsedText, "PARSED_DOCUMENT_TEXT"],
  ];
  for (const [text, source] of sources) {
    if (!text) continue;
    for (const value of extractIdentifierCandidates(text).shipmentNumbers) {
      const shipment = await lookup.findByShipmentNumber(input.accountId, value);
      if (shipment) resolved.push({ shipmentId: shipment.id, identifierType: "SHIPMENT_NUMBER", value, source });
    }
  }
  return resolved;
}

async function resolveByPoReference(
  input: MatchShipmentInput,
  lookup: ShipmentIdentifierLookup
): Promise<ResolvedCandidate[]> {
  const resolved: ResolvedCandidate[] = [];
  const sources: Array<[string | null, ResolvedCandidate["source"]]> = [
    [input.emailSubject, "EMAIL_SUBJECT"],
    [input.parsedText, "PARSED_DOCUMENT_TEXT"],
  ];
  for (const [text, source] of sources) {
    if (!text) continue;
    for (const value of extractIdentifierCandidates(text).poReferences) {
      const shipments = await lookup.findByPoReference(input.accountId, value);
      for (const shipment of shipments) {
        resolved.push({ shipmentId: shipment.id, identifierType: "PO_REFERENCE", value, source });
      }
    }
  }
  return resolved;
}

/**
 * Attempts to match a document to exactly one shipment. Shipment-number
 * matches take priority over PO-reference matches (system-generated ids are
 * a stronger signal than free-text references); PO matching is only tried
 * when no shipment-number candidate resolved.
 *
 * Auto-selects only when every resolved candidate points at the same
 * shipment -- two candidates resolving to two different shipments is a
 * conflict, and conflicts are persisted (for visibility) but never
 * auto-selected. Never falls back to "pick the first one."
 */
export async function matchShipmentForDocument(
  input: MatchShipmentInput,
  lookup: ShipmentIdentifierLookup = databaseShipmentIdentifierLookup
): Promise<{ matchedShipmentId: string | null }> {
  let resolved = await resolveByShipmentNumber(input, lookup);
  if (resolved.length === 0) {
    resolved = await resolveByPoReference(input, lookup);
  }

  if (resolved.length === 0) return { matchedShipmentId: null };

  const distinctShipmentIds = new Set(resolved.map((r) => r.shipmentId));
  const matchedShipmentId = distinctShipmentIds.size === 1 ? resolved[0].shipmentId : null;

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    await lookup.recordCandidate({
      accountId: input.accountId,
      documentId: input.documentId,
      shipmentId: r.shipmentId,
      matchedIdentifierType: r.identifierType,
      matchedValue: r.value,
      matchedSource: r.source,
      autoSelected: matchedShipmentId !== null && i === 0,
    });
  }

  return { matchedShipmentId };
}
