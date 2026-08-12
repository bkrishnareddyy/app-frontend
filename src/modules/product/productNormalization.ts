/**
 * Normalization for product data.
 *
 * Every normalizer here is pure, deterministic, and lossless in one direction:
 * the raw value the user or document supplied is always stored alongside the
 * normalized one. Normalization exists so that two records can be compared, not
 * so that the original can be thrown away — "1,000 PCS" and "1000 pcs" must
 * match each other while both still displaying as what the source actually said.
 *
 * The hard rule these functions follow is that a value which cannot be
 * normalized confidently comes back as `null`, never as a best guess. A null
 * normalized country means the origin claim shows its raw text and resolves to
 * no code; a fabricated code would be worse than either.
 */

import {
  COUNTRY_NAME_ALIASES,
  NOMENCLATURE_DIGIT_LENGTHS,
  isIsoAlpha2,
  lookupUnit,
  type IsoAlpha2,
  type UnitDimension,
} from "./productVocabulary";

/**
 * Collapses whitespace and trims. Applied before every other normalizer so a
 * value pasted out of a PDF with a non-breaking space behaves like a typed one.
 */
export function collapseWhitespace(value: string): string {
  return value.replace(/[\s   ]+/g, " ").trim();
}

/** Trims to null: an empty or whitespace-only string is absent, not empty. */
export function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = collapseWhitespace(value);
  return collapsed === "" ? null : collapsed;
}

/**
 * The comparison form of an identifier.
 *
 * Case, spaces, and the separators people sprinkle through part numbers are
 * removed, because "ABC-123", "abc 123" and "ABC123" are one part number in
 * every catalogue anyone has ever kept. Nothing else is removed: letters,
 * digits, and any other character a manufacturer chose to make meaningful all
 * survive, so "ABC/123" and "ABC#123" stay distinct.
 */
export function normalizeIdentifier(value: string): string {
  return collapseWhitespace(value).toUpperCase().replace(/[\s._-]/g, "");
}

/**
 * The comparison form of a free-text description or product name.
 *
 * Used for the deterministic name comparison in matching. Punctuation is
 * flattened to single spaces rather than deleted, so "wide-band" and "wide band"
 * agree while "wideband" stays its own string — deleting the separator would
 * merge words that a catalogue keeps apart.
 */
export function normalizeText(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Digits only. A tariff code's punctuation is presentation, not identity. */
export function normalizeClassificationCode(value: string): string {
  return value.replace(/\D/g, "");
}

export interface ClassificationCodeCheck {
  normalized: string;
  /** Whether the digit count is one the nomenclature actually uses. */
  wellFormed: boolean;
  /** The digit counts this nomenclature accepts, for the error message. */
  expectedLengths: readonly number[] | null;
}

/**
 * Checks the *shape* of a classification code against its nomenclature.
 *
 * This is not validation that the code exists. Qubere does not hold the tariff
 * schedules, so a code of the right length is accepted whether or not it is a
 * real heading. Saying otherwise would be claiming a capability the system does
 * not have.
 */
export function checkClassificationCode(
  nomenclature: string,
  rawCode: string
): ClassificationCodeCheck {
  const normalized = normalizeClassificationCode(rawCode);
  const expectedLengths = NOMENCLATURE_DIGIT_LENGTHS[nomenclature] ?? null;

  if (expectedLengths === null) {
    // An unlisted nomenclature has no shape to check against, so anything with
    // at least the HS six digits passes rather than being rejected on a rule
    // this file does not know.
    return { normalized, wellFormed: normalized.length >= 6, expectedLengths: null };
  }

  return {
    normalized,
    wellFormed: expectedLengths.includes(normalized.length),
    expectedLengths,
  };
}

/** The HS6 prefix shared by every national extension of a code. */
export function hsSixDigits(normalizedCode: string): string | null {
  return normalizedCode.length >= 6 ? normalizedCode.slice(0, 6) : null;
}

export interface NormalizedCountry {
  /** Exactly what the source said, whitespace-collapsed. Always kept. */
  raw: string;
  /** ISO alpha-2, or null when the raw value could not be resolved. */
  code: IsoAlpha2 | null;
}

/**
 * Resolves a country string to an ISO code, or leaves it unresolved.
 *
 * Only two things resolve: something already shaped like an alpha-2 code that is
 * in the ISO list, and a name in the alias table. A three-letter code is *not*
 * accepted, because alpha-3 and alpha-2 overlap in ways that would silently
 * mis-resolve, and nothing is fuzzy-matched.
 */
export function normalizeCountry(value: string): NormalizedCountry {
  const raw = collapseWhitespace(value);
  if (raw === "") return { raw, code: null };

  const upper = raw.toUpperCase();
  if (upper.length === 2 && isIsoAlpha2(upper)) return { raw, code: upper };

  const aliasKey = upper.replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();
  const alias = COUNTRY_NAME_ALIASES[aliasKey];
  return { raw, code: alias ?? null };
}

export interface NormalizedQuantity {
  value: number;
  /** Canonical unit symbol, e.g. "kg". */
  unit: string;
  dimension: UnitDimension;
  /** The value expressed in the dimension's base unit, for comparison. */
  baseValue: number;
}

/**
 * Normalizes a quantity and its unit into canonical form.
 *
 * Returns null when either half is unusable. A quantity whose unit cannot be
 * placed in a dimension is stored raw and left uncomparable rather than being
 * assumed to be pieces.
 */
export function normalizeQuantity(
  value: number | string,
  rawUnit: string | null | undefined
): NormalizedQuantity | null {
  const numeric = typeof value === "string" ? parseDecimal(value) : value;
  if (numeric === null || !Number.isFinite(numeric)) return null;

  const unitText = trimToNull(rawUnit ?? null);
  if (unitText === null) return null;

  const unit = lookupUnit(unitText);
  if (unit === null) return null;

  return {
    value: numeric,
    unit: unit.canonical,
    dimension: unit.dimension,
    baseValue: numeric * unit.toBase,
  };
}

/**
 * Parses a decimal written the way trade documents write them.
 *
 * Thousands separators are dropped and a comma decimal mark is honoured, but
 * only when the string is unambiguous: "1,234" is one thousand two hundred and
 * thirty-four, "1,23" is one point two three, and "1,23,456" — which is neither
 * convention used consistently — is rejected rather than guessed.
 */
export function parseDecimal(input: string): number | null {
  const text = collapseWhitespace(input).replace(/\s/g, "");
  if (text === "") return null;

  if (!/^[+-]?[\d.,]+$/.test(text)) return null;

  const sign = text.startsWith("-") ? -1 : 1;
  const digits = text.replace(/^[+-]/, "");

  const commas = (digits.match(/,/g) ?? []).length;
  const dots = (digits.match(/\./g) ?? []).length;

  let canonical: string;
  if (commas > 0 && dots > 0) {
    // Whichever separator appears last is the decimal mark.
    const decimalMark = digits.lastIndexOf(",") > digits.lastIndexOf(".") ? "," : ".";
    const grouping = decimalMark === "," ? "." : ",";
    canonical = digits.split(grouping).join("").replace(decimalMark, ".");
  } else if (commas > 0) {
    const parts = digits.split(",");
    const tail = parts.slice(1);
    const isGrouped = parts.length > 1 && tail.every((part) => part.length === 3);
    canonical = isGrouped ? parts.join("") : parts.length === 2 ? parts.join(".") : "";
  } else {
    canonical = digits;
  }

  if (canonical === "" || (canonical.match(/\./g) ?? []).length > 1) return null;

  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? sign * parsed : null;
}

/**
 * Parses a percentage for a composition row.
 *
 * Accepts "45", "45%", "45.5 %". Values outside 0–100 are rejected: a material
 * cannot be 120% of a product, and letting one through would corrupt the
 * completeness check on the composition tab.
 */
export function parsePercentage(input: string): number | null {
  const text = collapseWhitespace(input).replace(/%$/, "").trim();
  const parsed = parseDecimal(text);
  if (parsed === null) return null;
  if (parsed < 0 || parsed > 100) return null;
  return parsed;
}

/** Parses a boolean the way a spreadsheet column spells one. */
export function parseBoolean(input: string): boolean | null {
  const text = collapseWhitespace(input).toLowerCase();
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0"].includes(text)) return false;
  return null;
}

/**
 * Parses a date, accepting only unambiguous formats.
 *
 * ISO `YYYY-MM-DD` is the only accepted written form. `03/04/2026` is rejected
 * outright because it is March in one country and April in another, and a
 * silently wrong effective date on a classification is a filing problem.
 */
export function parseIsoDate(input: string): Date | null {
  const text = collapseWhitespace(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip guards against overflow dates like 2026-02-31.
  return parsed.toISOString().slice(0, 10) === text ? parsed : null;
}
