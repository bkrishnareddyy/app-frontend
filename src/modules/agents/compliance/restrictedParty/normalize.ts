// Restricted / Denied-Party Screening -- normalization.
//
// Deterministic, pure functions -- no DB, no I/O. Uppercases, strips
// punctuation, and removes noise words (legal-entity suffixes and common
// connectors) that would otherwise dilute name-matching signal. Mirrors the
// legacy `COMMON_WORDS` reference table from PartyScreening_Tables.sql as a
// hardcoded const, matching this repo's ADD_CVD_ALERTS/FDA_CHAPTERS
// hardcoded-reference-list convention -- no new schema for this.

/** Legal-entity suffixes and connector words excluded from name-matching signal. Abbreviated starter list -- documented gap, not exhaustive. */
export const COMMON_WORDS: readonly string[] = [
  "THE",
  "AND",
  "OF",
  "FOR",
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "INC",
  "INCORPORATED",
  "LTD",
  "LIMITED",
  "LLC",
  "LLP",
  "LP",
  "GMBH",
  "SA",
  "SAS",
  "SRL",
  "BV",
  "NV",
  "AG",
  "PLC",
  "PVT",
  "PTY",
  "KG",
  "OY",
  "AB",
  "AS",
  "SPA",
  "GROUP",
  "HOLDINGS",
  "HOLDING",
  "INTERNATIONAL",
  "INTL",
  "TRADING",
  "ENTERPRISES",
  "ENTERPRISE",
  "IMPORT",
  "IMPORTS",
  "EXPORT",
  "EXPORTS",
];

const COMMON_WORDS_SET = new Set(COMMON_WORDS);

/** Uppercase, trim, collapse whitespace, strip punctuation. Used for both exact-match comparison and as the input to tokenization. */
export function normalizeName(raw: string): string {
  return raw
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a normalized name into words, dropping single-character tokens (initials carry no matching signal alone). */
export function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter((w) => w.length > 1);
}

/** Tokenizes and strips COMMON_WORDS noise, then rejoins -- the form scoring/candidate-generation actually compares. */
export function stripCommonWords(normalized: string): string {
  return tokenize(normalized)
    .filter((w) => !COMMON_WORDS_SET.has(w))
    .join(" ");
}

/** Full normalization pipeline: normalize -> strip common words. Falls back to the merely-normalized form if stripping empties it out (e.g. a name that is entirely a legal suffix). */
export function normalizeForMatching(raw: string): string {
  const normalized = normalizeName(raw);
  const stripped = stripCommonWords(normalized);
  return stripped.length > 0 ? stripped : normalized;
}
