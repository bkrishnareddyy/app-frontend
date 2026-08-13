/**
 * Deterministic-before-generative matching for the Product Intelligence Agent.
 *
 * Given whatever identifiers and party names a line item carries, this
 * resolves manufacturer/supplier/brand-owner names to legal entities and then
 * runs the existing tenant-scoped, explainable product matcher. Nothing here
 * invents a match: identifiers that do not resolve stay null, and the matcher
 * itself decides EXACT_MATCH/POSSIBLE_MATCH/AMBIGUOUS/NO_MATCH with no
 * confidence blending from this module or from the LLM that runs afterward.
 */

import type { Product, ProductIdentifierType } from "@prisma/client";
import { EntityResolutionService } from "@/modules/entity/entityResolutionService";
import {
  findProductMatches,
  getProductSnapshotForIntelligence,
  type ProductActor,
} from "@/modules/product/productService";
import type { ProductMatchResult } from "@/modules/product/productMatching";
import type { ProductSnapshot } from "@/modules/product/productChangeDetection";

/** Below this score a name match is a candidate for review, not a resolved party. */
export const ENTITY_RESOLUTION_THRESHOLD = 80;

export type ProductPartyRoleName = "MANUFACTURER" | "SUPPLIER" | "BRAND_OWNER";

export interface PartyResolution {
  role: ProductPartyRoleName;
  rawName: string;
  legalEntityId: string | null;
  matchScore: number | null;
  matchReason: string | null;
}

export interface ProductIntelligenceLineInput {
  sku?: string | null;
  supplierSku?: string | null;
  manufacturerPartNumber?: string | null;
  model?: string | null;
  gtin?: string | null;
  manufacturerName?: string | null;
  supplierName?: string | null;
  brandOwnerName?: string | null;
  countryOfManufacture?: string | null;
}

export interface MatchedProduct {
  product: Product;
  snapshot: ProductSnapshot;
}

export interface LineItemMatchResult {
  match: ProductMatchResult;
  parties: PartyResolution[];
  matchedProduct: MatchedProduct | null;
}

/**
 * Resolves manufacturer/supplier/brand-owner independently. Supplier is never
 * assumed to be the manufacturer, and a brand owner is never assumed to be
 * either — three separate lookups, three separate (possibly null) results.
 */
export async function resolveLineItemParties(
  actor: ProductActor,
  line: ProductIntelligenceLineInput
): Promise<PartyResolution[]> {
  const roleCandidates: Array<{ role: ProductPartyRoleName; rawName: string }> = [
    { role: "MANUFACTURER", rawName: line.manufacturerName ?? "" },
    { role: "SUPPLIER", rawName: line.supplierName ?? "" },
    { role: "BRAND_OWNER", rawName: line.brandOwnerName ?? "" },
  ];
  const wanted = roleCandidates.filter((entry) => entry.rawName.trim() !== "");

  return Promise.all(
    wanted.map(async ({ role, rawName }) => {
      const resolution = await EntityResolutionService.resolveEntity({
        accountId: actor.accountId,
        rawName,
      });
      const best = resolution.bestMatch;
      const resolved = best !== null && best.matchScore >= ENTITY_RESOLUTION_THRESHOLD;
      return {
        role,
        rawName,
        legalEntityId: resolved ? best.legalEntityId : null,
        matchScore: best?.matchScore ?? null,
        matchReason: best?.matchReason ?? null,
      };
    })
  );
}

function buildIdentifiers(
  line: ProductIntelligenceLineInput
): Array<{ identifierType: ProductIdentifierType; value: string }> {
  const identifiers: Array<{ identifierType: ProductIdentifierType; value: string }> = [];
  if (line.sku) identifiers.push({ identifierType: "INTERNAL_SKU", value: line.sku });
  if (line.supplierSku) identifiers.push({ identifierType: "SUPPLIER_SKU", value: line.supplierSku });
  if (line.gtin) identifiers.push({ identifierType: "GTIN", value: line.gtin });
  if (line.manufacturerPartNumber) {
    identifiers.push({ identifierType: "MANUFACTURER_PART_NUMBER", value: line.manufacturerPartNumber });
  }
  if (line.model) identifiers.push({ identifierType: "MODEL_NUMBER", value: line.model });
  return identifiers;
}

/**
 * Resolves parties, then matches the line against the Product Master. On a
 * single EXACT_MATCH, also loads that product's current trusted-facts
 * snapshot so the comparison stage has something to compare against.
 */
export async function matchLineItemToProduct(
  actor: ProductActor,
  line: ProductIntelligenceLineInput
): Promise<LineItemMatchResult> {
  const parties = await resolveLineItemParties(actor, line);
  const manufacturer = parties.find((p) => p.role === "MANUFACTURER") ?? null;

  const match = await findProductMatches(actor, {
    identifiers: buildIdentifiers(line),
    manufacturerPartyId: manufacturer?.legalEntityId ?? null,
  });

  let matchedProduct: MatchedProduct | null = null;
  if (match.status === "EXACT_MATCH" && match.candidates.length === 1) {
    matchedProduct = await getProductSnapshotForIntelligence(actor, match.candidates[0].productId);
  }

  return { match, parties, matchedProduct };
}
