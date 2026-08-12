/**
 * Deterministic product matching.
 *
 * Given a description of goods — off a commercial invoice line, a CSV row, an
 * extracted document fact — this decides which product in the tenant's master it
 * refers to. It is rule-based and explainable by construction: every result
 * names the rule that produced it and the exact value that matched, so a broker
 * asked "why did you attach this line to that product?" has an answer that does
 * not begin with "the model thought".
 *
 * There is no embedding search, no similarity score, no fuzzy string distance
 * here, and that is a design decision rather than a gap. A near-miss match on a
 * part number attaches goods to the wrong classification and the wrong origin
 * claim, and the resulting entry is wrong in a way nobody reviews because it
 * looked confident. Where the evidence supports one product, this returns it;
 * where it supports several, it returns AMBIGUOUS and stops.
 *
 * The four outcomes:
 *
 *   EXACT_MATCH    exactly one product matched on an identifier scheme that is
 *                  unique within the tenant, or on a manufacturer-qualified part
 *                  number. Safe to attach automatically.
 *   POSSIBLE_MATCH exactly one product matched on weaker evidence — an
 *                  unqualified part number, or an exact name-and-brand
 *                  agreement. Needs a human to confirm.
 *   AMBIGUOUS      the evidence matched more than one product. Every candidate
 *                  is returned; none is chosen.
 *   NO_MATCH       nothing matched.
 *
 * Tenant scoping is the caller's job: this module only ever sees the candidate
 * set it is handed, and the service layer that builds that set filters by
 * accountId. Nothing here can reach across accounts because nothing here reaches
 * anywhere at all.
 */

import type { ProductIdentifierType, ProductMatchStatus } from "@prisma/client";
import { normalizeIdentifier, normalizeText, trimToNull } from "./productNormalization";

/**
 * Identifier schemes that identify one product within a tenant on their own.
 *
 * GTIN, UPC and EAN are globally administered, so a collision is a data error
 * rather than a legitimate reuse. INTERNAL_SKU is unique because the tenant's own
 * catalogue says so, and `Product.internalSku` carries a database constraint to
 * that effect.
 *
 * Notably not here: MANUFACTURER_PART_NUMBER and MODEL_NUMBER. Part number "1000"
 * is a real part for dozens of unrelated manufacturers, so it only identifies a
 * product once the manufacturer is known too.
 */
export const UNIQUE_IDENTIFIER_TYPES: readonly ProductIdentifierType[] = [
  "GTIN",
  "UPC",
  "EAN",
  "INTERNAL_SKU",
];

/** Schemes that identify a product only in combination with its manufacturer. */
export const MANUFACTURER_QUALIFIED_TYPES: readonly ProductIdentifierType[] = [
  "MANUFACTURER_PART_NUMBER",
  "MODEL_NUMBER",
  "STYLE_NUMBER",
];

export interface MatchableIdentifier {
  identifierType: ProductIdentifierType;
  normalizedValue: string;
}

/** The shape matching needs from a product. Free of Prisma and of the database. */
export interface MatchableProduct {
  id: string;
  productName: string;
  brand: string | null;
  internalSku: string | null;
  identifiers: readonly MatchableIdentifier[];
  /** Legal entity ids linked as MANUFACTURER, for qualifying a part number. */
  manufacturerPartyIds: readonly string[];
}

/** What the caller knows about the goods it is trying to identify. */
export interface MatchCandidateInput {
  identifiers?: readonly { identifierType: ProductIdentifierType; value: string }[];
  productName?: string | null;
  brand?: string | null;
  /**
   * The manufacturer, already resolved to a legal entity in this tenant. A raw
   * manufacturer *name* is deliberately not accepted: resolving a name to a
   * party is entity resolution, it belongs upstream, and doing it inline here
   * would smuggle a fuzzy comparison into a module that promises not to have one.
   */
  manufacturerPartyId?: string | null;
}

export type MatchRule =
  | "UNIQUE_IDENTIFIER"
  | "MANUFACTURER_QUALIFIED_IDENTIFIER"
  | "UNQUALIFIED_IDENTIFIER"
  | "NAME_AND_BRAND";

export interface ProductMatchCandidate {
  productId: string;
  rule: MatchRule;
  /** The identifier scheme that matched, where the rule used one. */
  identifierType: ProductIdentifierType | null;
  /** The normalized value both sides agreed on. */
  matchedValue: string;
  /** A sentence a reviewer can read, naming the evidence rather than a score. */
  explanation: string;
}

export interface ProductMatchResult {
  status: ProductMatchStatus;
  /** Every product the winning rule matched. One entry unless AMBIGUOUS. */
  candidates: readonly ProductMatchCandidate[];
  /** The rule that decided the outcome, or null for NO_MATCH. */
  rule: MatchRule | null;
}

const NO_MATCH: ProductMatchResult = { status: "NO_MATCH", candidates: [], rule: null };

/**
 * Rules in strength order. The first rule that matches anything decides the
 * outcome, including when what it matched is several products — a strong rule
 * finding two candidates means the catalogue has a genuine collision, and
 * quietly falling through to a weaker rule would hide it.
 */
export function matchProduct(
  input: MatchCandidateInput,
  products: readonly MatchableProduct[]
): ProductMatchResult {
  const inputIdentifiers = (input.identifiers ?? [])
    .map((identifier) => ({
      identifierType: identifier.identifierType,
      normalizedValue: normalizeIdentifier(identifier.value),
    }))
    .filter((identifier) => identifier.normalizedValue !== "");

  const uniqueRule = matchOnIdentifierTypes(
    inputIdentifiers,
    products,
    UNIQUE_IDENTIFIER_TYPES,
    "UNIQUE_IDENTIFIER",
    (identifierType, value) =>
      `Matched on ${identifierType}, which identifies one product within this account, with value ${value}.`
  );
  if (uniqueRule.length > 0) return decide(uniqueRule, "UNIQUE_IDENTIFIER");

  const qualifiedRule = matchQualified(inputIdentifiers, products, input.manufacturerPartyId ?? null);
  if (qualifiedRule.length > 0) return decide(qualifiedRule, "MANUFACTURER_QUALIFIED_IDENTIFIER");

  const unqualifiedRule = matchOnIdentifierTypes(
    inputIdentifiers,
    products,
    MANUFACTURER_QUALIFIED_TYPES,
    "UNQUALIFIED_IDENTIFIER",
    (identifierType, value) =>
      `Matched on ${identifierType} ${value}, without a known manufacturer to qualify it. The same part number can belong to unrelated manufacturers, so this needs confirmation.`
  );
  if (unqualifiedRule.length > 0) {
    // Never EXACT: a part number without its manufacturer is weak evidence even
    // when only one product happens to carry it today.
    return {
      status: unqualifiedRule.length === 1 ? "POSSIBLE_MATCH" : "AMBIGUOUS",
      candidates: unqualifiedRule,
      rule: "UNQUALIFIED_IDENTIFIER",
    };
  }

  const nameRule = matchOnNameAndBrand(input, products);
  if (nameRule.length > 0) {
    return {
      status: nameRule.length === 1 ? "POSSIBLE_MATCH" : "AMBIGUOUS",
      candidates: nameRule,
      rule: "NAME_AND_BRAND",
    };
  }

  return NO_MATCH;
}

function decide(candidates: ProductMatchCandidate[], rule: MatchRule): ProductMatchResult {
  return {
    status: candidates.length === 1 ? "EXACT_MATCH" : "AMBIGUOUS",
    candidates,
    rule,
  };
}

function matchOnIdentifierTypes(
  inputIdentifiers: readonly MatchableIdentifier[],
  products: readonly MatchableProduct[],
  types: readonly ProductIdentifierType[],
  rule: MatchRule,
  explain: (identifierType: ProductIdentifierType, value: string) => string
): ProductMatchCandidate[] {
  const wanted = inputIdentifiers.filter((identifier) => types.includes(identifier.identifierType));
  if (wanted.length === 0) return [];

  const candidates: ProductMatchCandidate[] = [];
  for (const product of products) {
    const hit = wanted.find((identifier) =>
      product.identifiers.some(
        (owned) =>
          owned.identifierType === identifier.identifierType &&
          owned.normalizedValue === identifier.normalizedValue
      )
    );
    if (hit) {
      candidates.push({
        productId: product.id,
        rule,
        identifierType: hit.identifierType,
        matchedValue: hit.normalizedValue,
        explanation: explain(hit.identifierType, hit.normalizedValue),
      });
    }
  }
  return candidates;
}

function matchQualified(
  inputIdentifiers: readonly MatchableIdentifier[],
  products: readonly MatchableProduct[],
  manufacturerPartyId: string | null
): ProductMatchCandidate[] {
  if (manufacturerPartyId === null) return [];

  const wanted = inputIdentifiers.filter((identifier) =>
    MANUFACTURER_QUALIFIED_TYPES.includes(identifier.identifierType)
  );
  if (wanted.length === 0) return [];

  const candidates: ProductMatchCandidate[] = [];
  for (const product of products) {
    if (!product.manufacturerPartyIds.includes(manufacturerPartyId)) continue;

    const hit = wanted.find((identifier) =>
      product.identifiers.some(
        (owned) =>
          owned.identifierType === identifier.identifierType &&
          owned.normalizedValue === identifier.normalizedValue
      )
    );
    if (hit) {
      candidates.push({
        productId: product.id,
        rule: "MANUFACTURER_QUALIFIED_IDENTIFIER",
        identifierType: hit.identifierType,
        matchedValue: hit.normalizedValue,
        explanation: `Matched on ${hit.identifierType} ${hit.normalizedValue} together with the manufacturer recorded on this product.`,
      });
    }
  }
  return candidates;
}

/**
 * Exact agreement on both normalized name and normalized brand.
 *
 * Both halves are required. Name alone matches every "Steel bracket" in a
 * catalogue, and this rule is already the weakest one that can produce a
 * suggestion at all.
 */
function matchOnNameAndBrand(
  input: MatchCandidateInput,
  products: readonly MatchableProduct[]
): ProductMatchCandidate[] {
  const name = trimToNull(input.productName ?? null);
  const brand = trimToNull(input.brand ?? null);
  if (name === null || brand === null) return [];

  const normalizedName = normalizeText(name);
  const normalizedBrand = normalizeText(brand);
  if (normalizedName === "" || normalizedBrand === "") return [];

  return products
    .filter(
      (product) =>
        normalizeText(product.productName) === normalizedName &&
        product.brand !== null &&
        normalizeText(product.brand) === normalizedBrand
    )
    .map((product) => ({
      productId: product.id,
      rule: "NAME_AND_BRAND" as const,
      identifierType: null,
      matchedValue: `${normalizedName} / ${normalizedBrand}`,
      explanation: `Product name and brand match this record exactly. No identifier was supplied, so this is a suggestion rather than a determination.`,
    }));
}

/** Whether a match may be attached without a human confirming it. */
export function isAutoAttachable(result: ProductMatchResult): boolean {
  return result.status === "EXACT_MATCH" && result.candidates.length === 1;
}
