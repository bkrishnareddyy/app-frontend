/**
 * Fact comparison, conflict detection, missing-information detection, and
 * readiness assessment for the Product Intelligence Agent.
 *
 * Every function here is pure and deterministic. A conflict is reported with
 * both sides' values and is never resolved by this module — not by picking
 * the higher-confidence source, and not by "voting" between the incoming
 * line item and the Product Master. Resolving a conflict is a human decision;
 * this module's job stops at naming it clearly.
 */

import type { ProductImpactFlag } from "@prisma/client";
import {
  detectProductChanges,
  revalidationSignals,
  type DetectedChange,
  type ProductSnapshot,
} from "@/modules/product/productChangeDetection";
import { normalizeText } from "@/modules/product/productNormalization";
import type { MatchedProduct, PartyResolution } from "./matching";
import type { ProductMatchResult } from "@/modules/product/productMatching";

export type ReadinessLevel = "READY" | "PARTIAL" | "INSUFFICIENT_DATA";

export interface ProductReadiness {
  productIdentity: ReadinessLevel;
  classification: ReadinessLevel;
  origin: ReadinessLevel;
  regulatory: ReadinessLevel;
  valuation: ReadinessLevel;
}

export type ConflictType = "PRODUCT_DATA_CONFLICT" | "ORIGIN_CLAIM_CONFLICT";

export interface ProductConflict {
  type: ConflictType;
  field: string;
  incomingValue: string | null;
  masterValue: string | null;
  explanation: string;
}

export interface MissingInformation {
  field: string;
  reason: string;
}

export interface RevalidationRecommendation {
  flag: ProductImpactFlag;
  reason: string;
}

export interface ComparisonInput {
  matchResult: ProductMatchResult;
  matchedProduct: MatchedProduct | null;
  parties: PartyResolution[];
  /** The line item's own declared origin claim, distinct from country of manufacture. */
  originClaim: string | null;
  countryOfManufacture: string | null;
  manufacturerPartNumber: string | null;
  model: string | null;
  enrichedDescription: string | null;
  materialComposition: string | null;
  essentialCharacter: string | null;
  endUse: string | null;
}

export interface ComparisonResult {
  conflicts: ProductConflict[];
  missingInformation: MissingInformation[];
  changes: DetectedChange[];
  recommendedActions: RevalidationRecommendation[];
  readiness: ProductReadiness;
}

const DETERMINED_PLACEHOLDERS = new Set([
  "not determined",
  "not determined from description",
  "not determined — enrichment requires gemini api",
  "material not specified in description",
]);

function isDetermined(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return !DETERMINED_PLACEHOLDERS.has(trimmed.toLowerCase());
}

/** Whether either string names the same thing as far as free text allows us to tell. */
function textsAgree(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === "" || nb === "") return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function detectMaterialConflict(
  materialComposition: string | null,
  snapshot: ProductSnapshot
): ProductConflict | null {
  if (!isDetermined(materialComposition) || snapshot.compositions.length === 0) return null;

  const agrees = snapshot.compositions.some((c) => textsAgree(materialComposition as string, c.material));
  if (agrees) return null;

  const masterValue = snapshot.compositions
    .map((c) => (c.percentage === null ? c.material : `${c.material} ${c.percentage}%`))
    .join(", ");

  return {
    type: "PRODUCT_DATA_CONFLICT",
    field: "materialComposition",
    incomingValue: materialComposition,
    masterValue,
    explanation:
      "The incoming material composition does not match any material recorded on the matched Product Master record.",
  };
}

function detectManufacturerConflict(
  parties: PartyResolution[],
  snapshot: ProductSnapshot
): ProductConflict | null {
  const manufacturer = parties.find((p) => p.role === "MANUFACTURER" && p.legalEntityId !== null);
  if (!manufacturer) return null;

  const masterManufacturers = snapshot.parties.filter((p) => p.role === "MANUFACTURER");
  if (masterManufacturers.length === 0) return null;

  const agrees = masterManufacturers.some((p) => p.legalEntityId === manufacturer.legalEntityId);
  if (agrees) return null;

  return {
    type: "PRODUCT_DATA_CONFLICT",
    field: "manufacturer",
    incomingValue: manufacturer.rawName,
    masterValue: masterManufacturers.map((p) => p.legalEntityId).join(", "),
    explanation:
      "The manufacturer resolved from this line item is not the manufacturer recorded on the matched Product Master record.",
  };
}

function detectIdentifierConflict(
  field: "manufacturerPartNumber" | "model",
  incomingValue: string | null,
  masterValues: readonly string[]
): ProductConflict | null {
  if (!isDetermined(incomingValue) || masterValues.length === 0) return null;
  const agrees = masterValues.some((v) => normalizeText(v) === normalizeText(incomingValue as string));
  if (agrees) return null;

  return {
    type: "PRODUCT_DATA_CONFLICT",
    field,
    incomingValue,
    masterValue: masterValues.join(", "),
    explanation: `The incoming ${field} does not match the value(s) recorded on the matched Product Master record.`,
  };
}

function detectCountryConflict(
  field: "countryOfManufacture" | "originClaim",
  factType: "MANUFACTURE_COUNTRY" | "ORIGIN_CLAIM",
  incomingValue: string | null,
  snapshot: ProductSnapshot
): ProductConflict | null {
  if (!isDetermined(incomingValue)) return null;
  const masterFacts = snapshot.countryFacts.filter((f) => f.factType === factType);
  if (masterFacts.length === 0) return null;

  const agrees = masterFacts.some((f) => normalizeText(f.country) === normalizeText(incomingValue as string));
  if (agrees) return null;

  return {
    type: field === "originClaim" ? "ORIGIN_CLAIM_CONFLICT" : "PRODUCT_DATA_CONFLICT",
    field,
    incomingValue,
    masterValue: masterFacts.map((f) => f.country).join(", "),
    explanation:
      field === "originClaim"
        ? "The declared country of origin on this line item disagrees with the origin claim recorded on the matched Product Master record. This is never resolved automatically."
        : "The country of manufacture on this line item disagrees with the manufacture-country fact recorded on the matched Product Master record.",
  };
}

function detectConflicts(input: ComparisonInput): ProductConflict[] {
  if (input.matchedProduct === null) return [];
  const { snapshot } = input.matchedProduct;

  const masterIdentifierValues = (
    type: "MANUFACTURER_PART_NUMBER" | "MODEL_NUMBER"
  ): readonly string[] =>
    input.matchResult.candidates
      .filter((c) => c.identifierType === type)
      .map((c) => c.matchedValue);

  return [
    detectMaterialConflict(input.materialComposition, snapshot),
    detectManufacturerConflict(input.parties, snapshot),
    detectIdentifierConflict(
      "manufacturerPartNumber",
      input.manufacturerPartNumber,
      masterIdentifierValues("MANUFACTURER_PART_NUMBER")
    ),
    detectIdentifierConflict("model", input.model, masterIdentifierValues("MODEL_NUMBER")),
    detectCountryConflict("countryOfManufacture", "MANUFACTURE_COUNTRY", input.countryOfManufacture, snapshot),
    detectCountryConflict("originClaim", "ORIGIN_CLAIM", input.originClaim, snapshot),
  ].filter((c): c is ProductConflict => c !== null);
}

function detectMissingInformation(input: ComparisonInput): MissingInformation[] {
  const missing: MissingInformation[] = [];

  if (!isDetermined(input.enrichedDescription)) {
    missing.push({ field: "enrichedDescription", reason: "No enriched description was determined." });
  }
  if (!isDetermined(input.materialComposition)) {
    missing.push({ field: "materialComposition", reason: "No material composition was determined." });
  }
  if (!isDetermined(input.essentialCharacter)) {
    missing.push({ field: "essentialCharacter", reason: "No essential character (GRI 3(b)) was determined." });
  }
  if (!isDetermined(input.endUse)) {
    missing.push({ field: "endUse", reason: "No end use was determined." });
  }

  if (input.matchedProduct !== null) {
    const { snapshot } = input.matchedProduct;
    const hasManufactureCountry = snapshot.countryFacts.some((f) => f.factType === "MANUFACTURE_COUNTRY");
    const hasOriginClaim = snapshot.countryFacts.some((f) => f.factType === "ORIGIN_CLAIM");
    if (!hasManufactureCountry && !isDetermined(input.countryOfManufacture)) {
      missing.push({
        field: "countryOfManufacture",
        reason: "Neither the Product Master nor this line item records a country of manufacture.",
      });
    }
    if (!hasOriginClaim && !isDetermined(input.originClaim)) {
      missing.push({
        field: "originClaim",
        reason: "Neither the Product Master nor this line item records an origin claim.",
      });
    }
  }

  return missing;
}

/**
 * Builds a synthetic "after" snapshot from incoming line-item facts so the
 * existing product-vs-product diff engine can be reused as-is for
 * incoming-line-vs-Product-Master comparison. Only fields this agent actually
 * observes are populated; everything else is left as the master's existing
 * value so the diff reports only what the line item actually speaks to.
 */
function buildIncomingSnapshot(input: ComparisonInput, master: ProductSnapshot): ProductSnapshot {
  const compositions = isDetermined(input.materialComposition)
    ? [{ material: input.materialComposition as string, percentage: null, componentName: null }]
    : master.compositions;

  const manufacturer = input.parties.find((p) => p.role === "MANUFACTURER" && p.legalEntityId !== null);
  const parties = manufacturer
    ? [
        ...master.parties.filter((p) => p.role !== "MANUFACTURER"),
        { role: "MANUFACTURER", legalEntityId: manufacturer.legalEntityId as string, manufacturingSite: null },
      ]
    : master.parties;

  const countryFacts = [...master.countryFacts.filter((f) => f.factType !== "MANUFACTURE_COUNTRY" && f.factType !== "ORIGIN_CLAIM")];
  if (isDetermined(input.countryOfManufacture)) {
    countryFacts.push({ factType: "MANUFACTURE_COUNTRY", country: input.countryOfManufacture as string });
  } else {
    countryFacts.push(...master.countryFacts.filter((f) => f.factType === "MANUFACTURE_COUNTRY"));
  }
  if (isDetermined(input.originClaim)) {
    countryFacts.push({ factType: "ORIGIN_CLAIM", country: input.originClaim as string });
  } else {
    countryFacts.push(...master.countryFacts.filter((f) => f.factType === "ORIGIN_CLAIM"));
  }

  return {
    ...master,
    customsDescription: isDetermined(input.enrichedDescription) ? (input.enrichedDescription as string) : master.customsDescription,
    compositions,
    parties,
    countryFacts,
  };
}

function detectChanges(input: ComparisonInput): DetectedChange[] {
  if (input.matchedProduct === null) return [];
  const after = buildIncomingSnapshot(input, input.matchedProduct.snapshot);
  return detectProductChanges(input.matchedProduct.snapshot, after);
}

function toRecommendedActions(changes: readonly DetectedChange[]): RevalidationRecommendation[] {
  return revalidationSignals(changes).map((signal) => ({ flag: signal.flag, reason: signal.reason }));
}

function assessReadiness(
  input: ComparisonInput,
  conflicts: readonly ProductConflict[],
  missing: readonly MissingInformation[],
  recommendedActions: readonly RevalidationRecommendation[]
): ProductReadiness {
  const missingFields = new Set(missing.map((m) => m.field));
  const conflictFields = new Set(conflicts.map((c) => c.field));

  const productIdentity: ReadinessLevel =
    input.matchResult.status === "EXACT_MATCH"
      ? "READY"
      : input.matchResult.status === "NO_MATCH"
        ? "INSUFFICIENT_DATA"
        : "PARTIAL";

  const classificationFields = ["enrichedDescription", "materialComposition", "essentialCharacter", "endUse"];
  const classificationMissing = classificationFields.filter((f) => missingFields.has(f)).length;
  const classificationConflict = classificationFields.some((f) => conflictFields.has(f));
  const classification: ReadinessLevel = classificationConflict
    ? "PARTIAL"
    : classificationMissing === 0
      ? "READY"
      : classificationMissing === classificationFields.length
        ? "INSUFFICIENT_DATA"
        : "PARTIAL";

  const originConflict = conflictFields.has("countryOfManufacture") || conflictFields.has("originClaim");
  const originMissing = missingFields.has("countryOfManufacture") || missingFields.has("originClaim");
  const origin: ReadinessLevel = originConflict
    ? "PARTIAL"
    : !originMissing && input.matchedProduct !== null
      ? "READY"
      : originMissing && (!isDetermined(input.countryOfManufacture) && !isDetermined(input.originClaim))
        ? "INSUFFICIENT_DATA"
        : "PARTIAL";

  const regulatoryFlagged = recommendedActions.some((a) => a.flag === "REGULATORY_REVALIDATION_REQUIRED");
  const regulatory: ReadinessLevel = regulatoryFlagged
    ? "PARTIAL"
    : input.matchedProduct !== null
      ? "READY"
      : "INSUFFICIENT_DATA";

  const valuationFlagged = recommendedActions.some((a) => a.flag === "VALUATION_REVIEW_REQUIRED");
  const valuation: ReadinessLevel = valuationFlagged
    ? "PARTIAL"
    : input.matchedProduct !== null
      ? "READY"
      : "INSUFFICIENT_DATA";

  return { productIdentity, classification, origin, regulatory, valuation };
}

export function compareLineItemToProductMaster(input: ComparisonInput): ComparisonResult {
  const conflicts = detectConflicts(input);
  const missingInformation = detectMissingInformation(input);
  const changes = detectChanges(input);
  const recommendedActions = toRecommendedActions(changes);
  const readiness = assessReadiness(input, conflicts, missingInformation, recommendedActions);

  return { conflicts, missingInformation, changes, recommendedActions, readiness };
}
