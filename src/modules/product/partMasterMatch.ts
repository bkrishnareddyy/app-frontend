/**
 * Part-master match for HTS classification routing.
 *
 * Given a line item and the account's canonical products, determines whether
 * the line item has an exact part-number match in the product master, and
 * whether the master's HTS code agrees with the proposed code.
 *
 * Pure function — no database, no React. Callers supply the lookup data.
 * Exact part number only: fuzzy matching here is how you silently misclassify.
 */

export interface CanonicalProductRecord {
  id: string;
  partNumber: string | null;
  htsCode: string | null;
  aliases: { aliasName: string }[];
}

export interface PartMasterMatchInput {
  partNumber: string | null;
  proposedHtsCode: string | null;
}

export type PartMasterMatchBasis = "PART_NUMBER" | "ALIAS" | "NONE";

export interface PartMasterMatchResult {
  matched: boolean;
  canonicalProductId: string | null;
  masterHtsCode: string | null;
  /** True when matched AND the master's HTS code equals the proposed code. */
  htsAgrees: boolean;
  basis: PartMasterMatchBasis;
}

const NO_MATCH: PartMasterMatchResult = {
  matched: false,
  canonicalProductId: null,
  masterHtsCode: null,
  htsAgrees: false,
  basis: "NONE",
};

function normalizePartNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\-_]/g, "");
}

function normalizeHts(code: string | null): string {
  if (!code) return "";
  // Strip dots and whitespace so "8481.80.5090" and "8481805090" compare equal.
  return code.replace(/[\s.]/g, "");
}

export function matchPartMaster(
  input: PartMasterMatchInput,
  canonicalProducts: CanonicalProductRecord[]
): PartMasterMatchResult {
  if (!input.partNumber?.trim()) return NO_MATCH;

  const needle = normalizePartNumber(input.partNumber);

  // Exact part-number match first.
  for (const product of canonicalProducts) {
    if (product.partNumber && normalizePartNumber(product.partNumber) === needle) {
      return buildResult(product, input.proposedHtsCode, "PART_NUMBER");
    }
  }

  // Alias match second — still exact, just stored on a related record.
  for (const product of canonicalProducts) {
    for (const alias of product.aliases) {
      if (normalizePartNumber(alias.aliasName) === needle) {
        return buildResult(product, input.proposedHtsCode, "ALIAS");
      }
    }
  }

  return NO_MATCH;
}

function buildResult(
  product: CanonicalProductRecord,
  proposedHtsCode: string | null,
  basis: PartMasterMatchBasis
): PartMasterMatchResult {
  const masterHtsCode = product.htsCode ?? null;
  const htsAgrees =
    masterHtsCode !== null &&
    proposedHtsCode !== null &&
    normalizeHts(masterHtsCode) === normalizeHts(proposedHtsCode);

  return {
    matched: true,
    canonicalProductId: product.id,
    masterHtsCode,
    htsAgrees,
    basis,
  };
}
