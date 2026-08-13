/**
 * Canonical name normalization pipeline for the product master.
 *
 * Normalizes a free-text product description into a canonical name that can be
 * matched against the product master. The pipeline runs in five ordered steps;
 * each step hands its output to the next. Pure, database-free functions live
 * here; the alias and duplicate lookups that need a database are in
 * `normalizationService.ts`.
 *
 * Hard rules this pipeline follows:
 *   - Null output when a step cannot produce a confident result. A null
 *     canonical name is better than a wrong one: a missing name is a gap the
 *     user can fill; a wrong one is a misclassification that may not be caught.
 *   - No hardcoded product-specific noise terms (no "256GB", "Black", etc.
 *     by name). Noise is expressed as patterns or category rules so the ruleset
 *     can be extended without touching this file.
 *   - No default values for identifiers (no "PN-9901", no "Germany", no HTS
 *     code invented from nothing). If extraction finds nothing, the field is
 *     null.
 */

// ---------------------------------------------------------------------------
// Step 1 — Noise stripping
// ---------------------------------------------------------------------------

/**
 * A single noise rule.
 *
 * `pattern` is applied to the description in order; the first match removes
 * the matched text. Rules whose patterns would match inside a meaningful word
 * (e.g. "class") should use word-boundary anchors.
 */
export interface NoiseRule {
  /** What the rule removes — a RegExp applied with the `gi` flags. */
  pattern: RegExp;
  /** Short label for tracing / test output. */
  label: string;
}

/**
 * The default noise ruleset.
 *
 * Patterns are listed roughly from most to least specific. Each runs once;
 * repeated application is handled by the `stripNoise` loop. The ruleset is
 * exported so callers can extend it (or replace it entirely) without forking
 * this module.
 */
export const DEFAULT_NOISE_RULES: readonly NoiseRule[] = [
  // Storage capacities — must precede bare number patterns
  { pattern: /\b\d+\s*(?:GB|TB|MB|PB)\b/gi, label: "storage-capacity" },
  // Screen / dimension sizes
  { pattern: /\b\d+(?:\.\d+)?\s*(?:inch|in|"|cm|mm)\b/gi, label: "dimension" },
  // Colour variants
  { pattern: /\b(?:black|white|silver|gold|rose gold|space gray|space grey|midnight|starlight|blue|red|green|yellow|purple|pink|orange|graphite|titanium|natural)\b/gi, label: "colour" },
  // Common generational / revision suffixes
  { pattern: /\b(?:v\d+(?:\.\d+)?|rev\s*\d+|mk\s*\d+|\d+(?:st|nd|rd|th)\s+gen(?:eration)?)\b/gi, label: "revision" },
  // Marketing tier names that recur across product lines
  { pattern: /\b(?:pro\s*max|pro\s*plus|ultra|plus|lite|mini|max|standard|basic|premium|professional|enterprise|express|advanced)\b/gi, label: "tier" },
  // Connectivity / wireless standards
  { pattern: /\b(?:wifi|wi-fi|bluetooth|bt|5g|4g|lte|nfc|usb-c|usb\s*3(?:\.\d)?|thunderbolt)\b/gi, label: "connectivity" },
  // Numeric-only suffix tokens (e.g. trailing model numbers added by retail)
  { pattern: /\s+\d{4,}(?:\s|$)/g, label: "trailing-numeric" },
];

/**
 * Removes noise tokens from a raw description.
 *
 * Applies the ruleset in order, collapsing each match to a single space.
 * Runs until no rule matches (convergence) or a safety limit is reached.
 */
export function stripNoise(description: string, rules: readonly NoiseRule[] = DEFAULT_NOISE_RULES): string {
  let current = description;
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    let changed = false;
    for (const rule of rules) {
      const next = current.replace(rule.pattern, " ");
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
    if (!changed) break;
    iterations++;
  }

  return current.replace(/\s{2,}/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Step 2 — Identifier extraction
// ---------------------------------------------------------------------------

export type ExtractedIdentifierScheme = "MANUFACTURER_PART_NUMBER" | "UPC" | "EAN" | "GTIN" | "INTERNAL_SKU";

export interface ExtractedIdentifier {
  scheme: ExtractedIdentifierScheme;
  value: string;
}

/**
 * Known prefixes that flag the following token as a part number.
 * Applied case-insensitively.
 */
const PART_NUMBER_PREFIXES = /\b(?:p\/n|pn|mpn|mfr#?|part#?|item#?|sku|model#?|ref#?)[\s:\-]*/gi;

/** Standard UPC-A: 12 digits. EAN-13: 13 digits. GTIN-14: 14 digits. */
const GTIN_PATTERN = /\b(\d{12,14})\b/g;

/** Typical part-number shape: letters, digits, hyphens. At least one letter and one digit. */
const PART_NUMBER_PATTERN = /\b([A-Z0-9][-A-Z0-9_/]{2,}[A-Z0-9])\b/gi;

/**
 * Extracts identifiers from the raw description before noise stripping.
 *
 * Runs on the original text so that identifiers containing digits (e.g.
 * "256GB" in a part number like "ABC256GB-BLK") are not removed first.
 */
export function extractIdentifiers(description: string): ExtractedIdentifier[] {
  const identifiers: ExtractedIdentifier[] = [];
  const seen = new Set<string>();

  // GTIN / UPC / EAN — pure digit strings of the right length
  for (const match of description.matchAll(GTIN_PATTERN)) {
    const value = match[1]!;
    if (!seen.has(value)) {
      seen.add(value);
      const scheme: ExtractedIdentifierScheme =
        value.length === 12 ? "UPC" : value.length === 13 ? "EAN" : "GTIN";
      identifiers.push({ scheme, value });
    }
  }

  // Part numbers flagged by a prefix keyword
  const prefixFlagged = description.replace(PART_NUMBER_PREFIXES, "\x00");
  const flagged = prefixFlagged.split("\x00").slice(1); // everything after a prefix
  for (const segment of flagged) {
    const first = segment.match(/^([A-Z0-9][-A-Z0-9_/]{1,}[A-Z0-9])/i);
    if (first) {
      const value = first[1]!.toUpperCase();
      if (!seen.has(value)) {
        seen.add(value);
        identifiers.push({ scheme: "MANUFACTURER_PART_NUMBER", value });
      }
    }
  }

  // General part-number shaped tokens — only if not already found as GTIN
  for (const match of description.matchAll(PART_NUMBER_PATTERN)) {
    const value = match[1]!.toUpperCase();
    if (!seen.has(value) && /[A-Z]/.test(value) && /\d/.test(value)) {
      seen.add(value);
      identifiers.push({ scheme: "MANUFACTURER_PART_NUMBER", value });
    }
  }

  return identifiers;
}

// ---------------------------------------------------------------------------
// Step 3 — Language normalization
// ---------------------------------------------------------------------------

/**
 * Common trade abbreviations and their expansions.
 * Entries are matched case-insensitively as whole words.
 */
export const ABBREVIATION_TABLE: Readonly<Record<string, string>> = {
  "s.s": "Stainless Steel",
  "ss": "Stainless Steel",
  "c.s": "Carbon Steel",
  "cs": "Carbon Steel",
  "g.i": "Galvanized Iron",
  "gi": "Galvanized Iron",
  "p.p": "Polypropylene",
  "pp": "Polypropylene",
  "pe": "Polyethylene",
  "pvc": "PVC",
  "hdpe": "HDPE",
  "ldpe": "LDPE",
  "npt": "NPT",
  "bsp": "BSP",
  "pn": "PN",
  "dn": "DN",
  "ansi": "ANSI",
  "asme": "ASME",
  "astm": "ASTM",
  "din": "DIN",
  "iso": "ISO",
  "iec": "IEC",
  "ul": "UL",
  "ce": "CE",
  "rohs": "RoHS",
  "oem": "OEM",
  "pcb": "PCB",
  "smd": "SMD",
  "assy": "Assembly",
  "asm": "Assembly",
  "mfg": "Manufacturing",
  "mfr": "Manufacturer",
  "qty": "Quantity",
  "ea": "Each",
  "pcs": "Pieces",
  "pc": "Piece",
};

const ABBREVIATION_PATTERN: RegExp = (() => {
  const keys = Object.keys(ABBREVIATION_TABLE)
    .map((key) => key.replace(/\./g, "\\."))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${keys.join("|")})\\b`, "gi");
})();

/**
 * Normalizes text for display as a canonical name:
 * 1. Expands known abbreviations.
 * 2. Title-cases each significant word.
 * 3. Collapses whitespace.
 */
export function normalizeLanguage(text: string): string {
  const expanded = text.replace(ABBREVIATION_PATTERN, (match) => {
    const expansion = ABBREVIATION_TABLE[match.toLowerCase()];
    return expansion ?? match;
  });

  // Title-case: capitalize first letter of each word, lowercase the rest,
  // preserving all-caps tokens like "ISO", "NPT", "UPC".
  const titled = expanded
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return word;
      if (/^[A-Z]{2,}$/.test(word)) return word; // keep all-caps
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");

  return titled.replace(/\s{2,}/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Step 4 — Fingerprint computation (for deduplication)
// ---------------------------------------------------------------------------

/**
 * The normalized fingerprint of a canonical name.
 *
 * Two names that produce the same fingerprint are treated as duplicates of
 * each other. Punctuation, case, and common stopwords are removed so that
 * "Stainless Steel Hydraulic Valve, 1/2 NPT" and
 * "stainless steel hydraulic valve 1/2 npt" share one fingerprint.
 */
export function computeFingerprint(canonicalName: string): string {
  const STOPWORDS = new Set(["the", "a", "an", "of", "for", "in", "and", "or", "with", "to"]);

  return canonicalName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .sort()
    .join("-");
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export interface NormalizationPipelineResult {
  /** The canonical name, or null if the pipeline could not produce one. */
  canonicalName: string | null;
  /** The name after noise stripping, before language normalization. */
  strippedName: string;
  /** Identifiers extracted from the raw description before stripping. */
  extractedIdentifiers: ExtractedIdentifier[];
  /** The fingerprint for deduplication, or null if canonicalName is null. */
  fingerprint: string | null;
  /** Whether the input was too sparse to yield a meaningful result. */
  tooSparse: boolean;
}

/**
 * The minimum word count after stripping for a canonical name to be useful.
 * A one-word result like "Valve" cannot be deduplicated meaningfully.
 */
const MIN_MEANINGFUL_WORDS = 2;

/**
 * Runs the full normalization pipeline on a raw product description.
 *
 * @param rawDescription - What the user or document supplied.
 * @param rules - Noise rules; defaults to `DEFAULT_NOISE_RULES`.
 */
export function runNormalizationPipeline(
  rawDescription: string,
  rules: readonly NoiseRule[] = DEFAULT_NOISE_RULES
): NormalizationPipelineResult {
  const trimmed = rawDescription.trim();
  if (trimmed.length === 0) {
    return { canonicalName: null, strippedName: "", extractedIdentifiers: [], fingerprint: null, tooSparse: true };
  }

  // Step 2: extract identifiers from the raw text first
  const extractedIdentifiers = extractIdentifiers(trimmed);

  // Step 1: strip noise
  const strippedName = stripNoise(trimmed, rules);

  // Step 3: language normalization
  const normalized = normalizeLanguage(strippedName);

  // Check minimum length
  const wordCount = normalized.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < MIN_MEANINGFUL_WORDS) {
    return { canonicalName: null, strippedName, extractedIdentifiers, fingerprint: null, tooSparse: true };
  }

  const canonicalName = normalized;

  // Step 4: fingerprint
  const fingerprint = computeFingerprint(canonicalName);

  return { canonicalName, strippedName, extractedIdentifiers, fingerprint, tooSparse: false };
}
