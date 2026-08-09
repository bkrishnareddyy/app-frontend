/**
 * Extraction review model.
 *
 * A correction is stored as a NEW ExtractionField row rather than an update, so
 * the machine's original reading is never overwritten and the correction history
 * is immutable by construction. `source` distinguishes the two, and the ordering
 * rules here — not a raw `confidence DESC` — decide which reading is current.
 *
 * Pure: no database, no React. Everything here is exercised directly by tests.
 */

export const HUMAN_CORRECTION_SOURCE = "HUMAN_CORRECTION";

/**
 * A reviewed value is not a model prediction, so it carries no model score.
 * Confidence stays null on a correction; `source` is what makes it authoritative.
 */
export const REVIEW_REQUIRED_BELOW = 80;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawExtractionField {
  id: string;
  fieldName: string;
  value: string;
  confidence: number | null;
  pageNumber: number | null;
  bbox: unknown;
  source: string;
  createdAt: Date | string;
}

export interface FieldRevision {
  id: string;
  value: string;
  confidence: number | null;
  source: string;
  createdAt: string;
  isCorrection: boolean;
}

export interface ReviewField {
  fieldName: string;
  /** The reading in force: the newest human correction, else the best machine read. */
  currentValue: string;
  /** The machine's first reading. Null when the field only ever came from a human. */
  originalValue: string | null;
  /** Model confidence of the machine reading. Null when never scored. */
  confidence: number | null;
  pageNumber: number | null;
  bbox: BoundingBox | null;
  corrected: boolean;
  /** True when a reviewer should look at it: low or absent confidence, uncorrected. */
  needsReview: boolean;
  /** Newest first. Every reading ever stored for this field. */
  history: FieldRevision[];
}

/** Accepts the stored Json column, which may be anything. */
export function parseBoundingBox(raw: unknown): BoundingBox | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const x = candidate.x;
  const y = candidate.y;
  const width = candidate.width;
  const height = candidate.height;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return null;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function newestFirst(a: FieldRevision, b: FieldRevision): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Groups raw rows into one entry per field name.
 *
 * Precedence for the current reading is explicit: the newest human correction
 * wins outright. Confidence only breaks ties between machine readings, because a
 * reviewed value is not competing on model score.
 */
export function buildReviewFields(rows: RawExtractionField[]): ReviewField[] {
  const byName = new Map<string, RawExtractionField[]>();
  for (const row of rows) {
    const bucket = byName.get(row.fieldName);
    if (bucket) bucket.push(row);
    else byName.set(row.fieldName, [row]);
  }

  const fields: ReviewField[] = [];

  for (const [fieldName, group] of byName) {
    const history: FieldRevision[] = group
      .map((row) => ({
        id: row.id,
        value: row.value,
        confidence: row.confidence,
        source: row.source,
        createdAt: toIso(row.createdAt),
        isCorrection: row.source === HUMAN_CORRECTION_SOURCE,
      }))
      .sort(newestFirst);

    const corrections = history.filter((rev) => rev.isCorrection);
    const machineReads = group.filter((row) => row.source !== HUMAN_CORRECTION_SOURCE);

    // Best machine read: highest confidence, and among equals the newest.
    const bestMachineRead = [...machineReads].sort((a, b) => {
      const aScore = a.confidence ?? -1;
      const bScore = b.confidence ?? -1;
      if (aScore !== bScore) return bScore - aScore;
      return toIso(b.createdAt).localeCompare(toIso(a.createdAt));
    })[0];

    // Oldest machine read is what the extractor first said.
    const firstMachineRead = [...machineReads].sort((a, b) =>
      toIso(a.createdAt).localeCompare(toIso(b.createdAt))
    )[0];

    const current = corrections[0] ?? history[0];
    const corrected = corrections.length > 0;

    // Provenance follows the machine read; a correction inherits where the value
    // was found rather than claiming a location a reviewer never pointed at.
    const provenance = bestMachineRead ?? group[0];

    fields.push({
      fieldName,
      currentValue: current.value,
      originalValue: firstMachineRead?.value ?? null,
      confidence: bestMachineRead?.confidence ?? null,
      pageNumber: provenance?.pageNumber ?? null,
      bbox: parseBoundingBox(provenance?.bbox ?? null),
      corrected,
      needsReview:
        !corrected &&
        (bestMachineRead === undefined ||
          bestMachineRead.confidence === null ||
          bestMachineRead.confidence < REVIEW_REQUIRED_BELOW),
      history,
    });
  }

  return fields.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
}

/** Pages that actually carry a located field, so navigation cannot offer empty pages. */
export function pagesWithFields(fields: ReviewField[]): number[] {
  const pages = new Set<number>();
  for (const field of fields) {
    if (field.pageNumber !== null) pages.add(field.pageNumber);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Index of the next field needing review, wrapping around. Returns -1 when none
 * do, so the caller can say "nothing left to review" rather than moving focus.
 */
export function nextReviewIndex(fields: ReviewField[], from: number): number {
  if (fields.length === 0) return -1;
  for (let step = 1; step <= fields.length; step += 1) {
    const index = (from + step + fields.length * 2) % fields.length;
    if (fields[index].needsReview) return index;
  }
  return -1;
}

export interface CorrectionValidation {
  ok: boolean;
  reason?: string;
  value?: string;
}

export const CORRECTION_MAX_LENGTH = 2000;

/** A correction that matches the current reading is not a correction. */
export function validateCorrection(
  raw: unknown,
  currentValue: string
): CorrectionValidation {
  if (typeof raw !== "string") {
    return { ok: false, reason: "A corrected value must be text." };
  }
  const value = raw.trim();
  if (value === "") {
    return { ok: false, reason: "A corrected value cannot be empty." };
  }
  if (value.length > CORRECTION_MAX_LENGTH) {
    return {
      ok: false,
      reason: `A corrected value cannot exceed ${CORRECTION_MAX_LENGTH} characters.`,
    };
  }
  if (value === currentValue) {
    return { ok: false, reason: "The value is unchanged." };
  }
  return { ok: true, value };
}
