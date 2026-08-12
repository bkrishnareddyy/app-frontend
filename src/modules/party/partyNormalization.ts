/**
 * Normalization for party data.
 *
 * Mirrors the product module's normalization module in spirit — every
 * normalizer is pure, deterministic, and lossless in one direction: the raw
 * value a source gave is always stored alongside the normalized one, never
 * replaced by it. A value that cannot be normalized confidently comes back as
 * `null` or as itself unresolved, never as a best guess: a wrong ISO code on a
 * registration is a compliance misstatement, a missing one is merely
 * incomplete.
 */

import { COUNTRY_NAME_ALIASES, isIsoAlpha2, type IsoAlpha2 } from "./partyVocabulary";

/** Collapses whitespace and trims, applied before every other normalizer. */
export function collapseWhitespace(value: string): string {
  return value.replace(/[\s   ]+/g, " ").trim();
}

/** Trims to null: an empty or whitespace-only string is absent, not empty. */
export function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = collapseWhitespace(value);
  return collapsed === "" ? null : collapsed;
}

/**
 * The comparison form of an identifier (EORI, DUNS, LEI, VAT, a customer or
 * supplier number). Case, spaces, and the separators sources sprinkle through
 * reference numbers are removed; nothing else is, so two identifiers that
 * differ in any other character stay distinct.
 */
export function normalizeIdentifier(value: string): string {
  return collapseWhitespace(value).toUpperCase().replace(/[\s._-]/g, "");
}

/**
 * Legal-form suffixes folded out of a party name for comparison.
 *
 * Kept small and unambiguous on purpose, the same way the country alias table
 * is: every entry is a legal-form marker, not a word that could also be part
 * of a trade name. Nothing here is stripped from the middle of a name, only
 * from the end, so "Ltd Trading Co" (a trade name that happens to start with
 * a suffix word) is not touched at its front.
 */
const LEGAL_SUFFIXES = [
  "INCORPORATED",
  "INC",
  "CORPORATION",
  "CORP",
  "COMPANY",
  "CO",
  "LIMITED",
  "LTD",
  "LLC",
  "LLP",
  "LP",
  "PLC",
  "GMBH",
  "AG",
  "SAS",
  "SARL",
  "SA",
  "SRL",
  "SPA",
  "BV",
  "NV",
  "OY",
  "AB",
  "AS",
  "APS",
  "KFT",
  "PTY",
  "PTE",
] as const;

/**
 * The comparison form of a party name.
 *
 * Used for the deterministic name comparison in matching. Punctuation is
 * flattened to single spaces rather than deleted (so "A.B. Trading" and "AB
 * Trading" stay distinct from "ABTrading"), then trailing legal-form suffixes
 * are folded away one at a time so "Acme Trading Co., Ltd." and "Acme Trading"
 * compare equal while the raw name each source gave is preserved separately.
 */
export function normalizeLegalName(value: string): string {
  const flattened = collapseWhitespace(value)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  const tokens = flattened.split(" ").filter(Boolean);
  while (tokens.length > 1 && (LEGAL_SUFFIXES as readonly string[]).includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/**
 * The comparison form of free text that is not a legal name (e.g. a contact
 * name or a note). Lower-cased and punctuation-flattened, with no suffix
 * folding — that behaviour is specific to legal names.
 */
export function normalizeText(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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
 * Only two things resolve: something already shaped like an alpha-2 code that
 * is in the ISO list, and a name in the alias table. Nothing is fuzzy-matched.
 * This function is used independently for a registration's country, an
 * address's country, and an identifier's issuing country — none of the three
 * is ever derived from either of the others.
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

/**
 * Parses a date, accepting only unambiguous ISO `YYYY-MM-DD` form — the same
 * rule the product module applies, for the same reason: a registration date
 * read in the wrong locale is a wrong fact, not a display quirk.
 */
export function parseIsoDate(input: string): Date | null {
  const text = collapseWhitespace(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === text ? parsed : null;
}
