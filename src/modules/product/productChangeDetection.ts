/**
 * Customs-significant change detection.
 *
 * When a product record changes, the question that matters is not "what field
 * moved" but "does anything that was already decided about this product need
 * looking at again". A colour correction does not. A change of primary material
 * does, because the classification approved last quarter was approved against
 * the old material.
 *
 * What this module produces is a **workflow signal**, never a customs decision.
 * It says CLASSIFICATION_REVALIDATION_REQUIRED; it does not withdraw the
 * classification, does not propose a new code, and does not touch approval
 * status. Approved decisions stay approved and stay usable until a person
 * revisits them — silently invalidating a classification because a description
 * was reworded would be a system making a customs call on its own, which it must
 * not do.
 *
 * The module is pure: it compares two snapshots and returns findings. Writing
 * change events and revalidation flags is the service's job.
 */

import type { ProductChangeSignificance, ProductImpactFlag } from "@prisma/client";
import { findAttributeDefinition, isAttributeCustomsSignificant } from "./productAttributes";
import { normalizeText, trimToNull } from "./productNormalization";

/**
 * The customs-relevant surface of a product, flattened for comparison.
 *
 * Deliberately not the database rows. Ids, timestamps and audit columns change
 * constantly and mean nothing here; what is compared is the set of facts a
 * classifier or origin analyst would have read.
 */
export interface ProductSnapshot {
  productName: string;
  commercialDescription: string | null;
  technicalDescription: string | null;
  customsDescription: string | null;
  brand: string | null;
  model: string | null;
  attributes: readonly SnapshotAttribute[];
  compositions: readonly SnapshotComposition[];
  parties: readonly SnapshotParty[];
  countryFacts: readonly SnapshotCountryFact[];
}

export interface SnapshotAttribute {
  attributeCode: string;
  /** Normalized where one exists, raw otherwise. Compared as text. */
  value: string;
  unit: string | null;
}

export interface SnapshotComposition {
  material: string;
  percentage: number | null;
  componentName: string | null;
}

export interface SnapshotParty {
  role: string;
  legalEntityId: string;
  manufacturingSite: string | null;
}

export interface SnapshotCountryFact {
  factType: string;
  /** ISO code where resolved, raw text otherwise. */
  country: string;
}

export interface DetectedChange {
  /** The entity that changed, e.g. "Product", "ProductAttribute:NET_WEIGHT". */
  entity: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  significance: ProductChangeSignificance;
  impactFlags: readonly ProductImpactFlag[];
  /** Why this rises to the significance it does, for the history tab. */
  reason: string;
}

const CLASSIFICATION: ProductImpactFlag = "CLASSIFICATION_REVALIDATION_REQUIRED";
const ORIGIN: ProductImpactFlag = "ORIGIN_REVALIDATION_REQUIRED";
const REGULATORY: ProductImpactFlag = "REGULATORY_REVALIDATION_REQUIRED";
const VALUATION: ProductImpactFlag = "VALUATION_REVIEW_REQUIRED";

interface DescriptorRule {
  field: keyof ProductSnapshot;
  significance: ProductChangeSignificance;
  impactFlags: readonly ProductImpactFlag[];
  reason: string;
}

/**
 * The four descriptions are graded separately because they are read by different
 * people for different purposes. The customs description is the one that ends up
 * on the entry, so changing it is unambiguously significant; the commercial
 * description is marketing copy that nonetheless appears on the invoice, so it
 * is worth a look without being decisive.
 */
const DESCRIPTOR_RULES: readonly DescriptorRule[] = [
  {
    field: "customsDescription",
    significance: "CUSTOMS_SIGNIFICANT",
    impactFlags: [CLASSIFICATION],
    reason: "The customs description is what is declared. A change to it can change the classification it supports.",
  },
  {
    field: "technicalDescription",
    significance: "CUSTOMS_SIGNIFICANT",
    impactFlags: [CLASSIFICATION],
    reason: "The technical description is the basis on which the product was classified.",
  },
  {
    field: "commercialDescription",
    significance: "POTENTIALLY_CUSTOMS_SIGNIFICANT",
    impactFlags: [CLASSIFICATION, VALUATION],
    reason: "The commercial description appears on the invoice and may reflect a change in what is actually being sold.",
  },
  {
    field: "model",
    significance: "POTENTIALLY_CUSTOMS_SIGNIFICANT",
    impactFlags: [CLASSIFICATION],
    reason: "A model change often accompanies a specification change, which classification depends on.",
  },
  {
    field: "productName",
    significance: "NON_MATERIAL",
    impactFlags: [],
    reason: "The product name is a label for people; nothing is declared from it.",
  },
  {
    field: "brand",
    significance: "NON_MATERIAL",
    impactFlags: [],
    reason: "Brand does not determine classification, origin, or value.",
  },
];

export function detectProductChanges(
  before: ProductSnapshot,
  after: ProductSnapshot
): DetectedChange[] {
  return [
    ...detectDescriptorChanges(before, after),
    ...detectAttributeChanges(before, after),
    ...detectCompositionChanges(before, after),
    ...detectPartyChanges(before, after),
    ...detectCountryFactChanges(before, after),
  ];
}

function detectDescriptorChanges(
  before: ProductSnapshot,
  after: ProductSnapshot
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const rule of DESCRIPTOR_RULES) {
    const oldValue = trimToNull(before[rule.field] as string | null);
    const newValue = trimToNull(after[rule.field] as string | null);
    if (oldValue === newValue) continue;

    // A pure reformat — same words, different spacing or casing — is recorded
    // but never raises a signal, because nothing about the goods changed.
    const cosmetic =
      oldValue !== null && newValue !== null && normalizeText(oldValue) === normalizeText(newValue);

    changes.push({
      entity: "Product",
      field: rule.field,
      oldValue,
      newValue,
      significance: cosmetic ? "NON_MATERIAL" : rule.significance,
      impactFlags: cosmetic ? [] : rule.impactFlags,
      reason: cosmetic
        ? "Wording is unchanged once punctuation and case are set aside."
        : rule.reason,
    });
  }

  return changes;
}

/** The flags an attribute's group implies when the attribute is significant. */
function attributeImpact(attributeCode: string): readonly ProductImpactFlag[] {
  const definition = findAttributeDefinition(attributeCode);
  if (definition === null) return [CLASSIFICATION, ORIGIN, REGULATORY];

  switch (definition.group) {
    case "REGULATORY":
      return [REGULATORY];
    case "MATERIAL":
      return [CLASSIFICATION, ORIGIN];
    case "COMMERCIAL":
      return [VALUATION];
    case "PHYSICAL":
    case "FUNCTIONAL":
    case "ELECTRICAL":
    case "PACKAGING":
      return [CLASSIFICATION];
  }
}

function attributeKey(attribute: SnapshotAttribute): string {
  return attribute.attributeCode.toUpperCase();
}

function attributeValue(attribute: SnapshotAttribute): string {
  return attribute.unit === null ? attribute.value : `${attribute.value} ${attribute.unit}`;
}

function detectAttributeChanges(
  before: ProductSnapshot,
  after: ProductSnapshot
): DetectedChange[] {
  const beforeMap = new Map(before.attributes.map((a) => [attributeKey(a), a]));
  const afterMap = new Map(after.attributes.map((a) => [attributeKey(a), a]));
  const codes = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: DetectedChange[] = [];
  for (const code of codes) {
    const oldAttribute = beforeMap.get(code) ?? null;
    const newAttribute = afterMap.get(code) ?? null;
    const oldValue = oldAttribute === null ? null : attributeValue(oldAttribute);
    const newValue = newAttribute === null ? null : attributeValue(newAttribute);
    if (oldValue === newValue) continue;

    const significant = isAttributeCustomsSignificant(code);
    const definition = findAttributeDefinition(code);

    changes.push({
      entity: `ProductAttribute:${code}`,
      field: "value",
      oldValue,
      newValue,
      significance: significant ? "CUSTOMS_SIGNIFICANT" : "NON_MATERIAL",
      impactFlags: significant ? attributeImpact(code) : [],
      reason:
        definition === null
          ? "This attribute is not in the catalogue, so it is treated as customs-significant. An unrecognised fact that turns out to matter is worse than a signal that turns out to be unnecessary."
          : significant
            ? (definition.guidance ??
              `${definition.label} is recorded as customs-significant in the attribute catalogue.`)
            : `${definition.label} does not affect classification, origin, or value.`,
    });
  }

  return changes;
}

function compositionKey(composition: SnapshotComposition): string {
  return `${normalizeText(composition.material)}|${normalizeText(composition.componentName ?? "")}`;
}

/**
 * Composition changes are the strongest signal in this module.
 *
 * What a product is made of drives its classification and is the input to every
 * rule of origin, so a material appearing, disappearing, or shifting percentage
 * raises both signals — always, with no threshold. A "small" percentage change
 * is exactly what moves a good across a regional-value-content line.
 */
function detectCompositionChanges(
  before: ProductSnapshot,
  after: ProductSnapshot
): DetectedChange[] {
  const beforeMap = new Map(before.compositions.map((c) => [compositionKey(c), c]));
  const afterMap = new Map(after.compositions.map((c) => [compositionKey(c), c]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: DetectedChange[] = [];
  for (const key of keys) {
    const oldRow = beforeMap.get(key) ?? null;
    const newRow = afterMap.get(key) ?? null;
    const oldValue = oldRow === null ? null : describeComposition(oldRow);
    const newValue = newRow === null ? null : describeComposition(newRow);
    if (oldValue === newValue) continue;

    changes.push({
      entity: "ProductComposition",
      field: oldRow === null ? "added" : newRow === null ? "removed" : "percentage",
      oldValue,
      newValue,
      significance: "CUSTOMS_SIGNIFICANT",
      impactFlags: [CLASSIFICATION, ORIGIN],
      reason:
        "Material composition determines classification and is the input to every rule of origin. Any change to it requires both to be looked at again.",
    });
  }

  return changes;
}

function describeComposition(composition: SnapshotComposition): string {
  const name = composition.componentName === null ? "" : ` (${composition.componentName})`;
  const percentage = composition.percentage === null ? "" : ` ${composition.percentage}%`;
  return `${composition.material}${name}${percentage}`.trim();
}

/**
 * Manufacturer and site changes.
 *
 * A new manufacturer does not change the product's origin — origin is a legal
 * conclusion drawn from where production steps happened and what rule applies,
 * not from who owns the factory. What it does is make the existing origin
 * position unsafe to rely on until someone checks it, which is precisely what
 * the ORIGIN_REVALIDATION_REQUIRED signal says.
 */
function detectPartyChanges(before: ProductSnapshot, after: ProductSnapshot): DetectedChange[] {
  const key = (party: SnapshotParty) => `${party.role}|${party.legalEntityId}`;
  const beforeMap = new Map(before.parties.map((p) => [key(p), p]));
  const afterMap = new Map(after.parties.map((p) => [key(p), p]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: DetectedChange[] = [];
  for (const partyKey of keys) {
    const oldRow = beforeMap.get(partyKey) ?? null;
    const newRow = afterMap.get(partyKey) ?? null;
    const oldValue = oldRow === null ? null : describeParty(oldRow);
    const newValue = newRow === null ? null : describeParty(newRow);
    if (oldValue === newValue) continue;

    const role = (newRow ?? oldRow)?.role ?? "PARTY";
    const manufacturingRole = role === "MANUFACTURER";

    changes.push({
      entity: `ProductParty:${role}`,
      field: oldRow === null ? "added" : newRow === null ? "removed" : "manufacturingSite",
      oldValue,
      newValue,
      significance: manufacturingRole ? "CUSTOMS_SIGNIFICANT" : "POTENTIALLY_CUSTOMS_SIGNIFICANT",
      impactFlags: manufacturingRole ? [ORIGIN, REGULATORY] : [VALUATION],
      reason: manufacturingRole
        ? "Who manufactures the goods, and where, does not itself establish origin, but it makes the existing origin position and any facility-based regulatory position unsafe to rely on until reviewed."
        : "A change of supplier or brand owner can affect the transaction being valued.",
    });
  }

  return changes;
}

function describeParty(party: SnapshotParty): string {
  return party.manufacturingSite === null
    ? party.legalEntityId
    : `${party.legalEntityId} @ ${party.manufacturingSite}`;
}

/**
 * Country facts.
 *
 * Note what is *not* here: nothing promotes a manufacture country into an origin
 * claim, and nothing derives one from the other. They are separate facts with
 * separate lifecycles, and a change to either only ever asks for the origin
 * position to be revalidated.
 */
function detectCountryFactChanges(
  before: ProductSnapshot,
  after: ProductSnapshot
): DetectedChange[] {
  const key = (fact: SnapshotCountryFact) => `${fact.factType}|${fact.country.toUpperCase()}`;
  const beforeKeys = new Set(before.countryFacts.map(key));
  const afterKeys = new Set(after.countryFacts.map(key));

  const changes: DetectedChange[] = [];

  for (const fact of after.countryFacts) {
    if (beforeKeys.has(key(fact))) continue;
    changes.push(countryChange(fact, null, fact.country));
  }
  for (const fact of before.countryFacts) {
    if (afterKeys.has(key(fact))) continue;
    changes.push(countryChange(fact, fact.country, null));
  }

  return changes;
}

function countryChange(
  fact: SnapshotCountryFact,
  oldValue: string | null,
  newValue: string | null
): DetectedChange {
  const isOriginClaim = fact.factType === "ORIGIN_CLAIM";
  return {
    entity: `ProductCountryFact:${fact.factType}`,
    field: oldValue === null ? "added" : "removed",
    oldValue,
    newValue,
    significance: "CUSTOMS_SIGNIFICANT",
    impactFlags: [ORIGIN],
    reason: isOriginClaim
      ? "The declared country of origin changed. The claim and its supporting evidence need to be re-established."
      : "Where the goods are made changed. This is not the country of origin, but the origin determination was made against the old production picture and needs revisiting.",
  };
}

/** The distinct signals a set of changes asks for, with the reason for each. */
export interface RevalidationSignal {
  flag: ProductImpactFlag;
  reason: string;
  /** Indexes into the change list that raised this flag. */
  triggeredBy: readonly number[];
}

export function revalidationSignals(changes: readonly DetectedChange[]): RevalidationSignal[] {
  const byFlag = new Map<ProductImpactFlag, { reasons: string[]; indexes: number[] }>();

  changes.forEach((change, index) => {
    for (const flag of change.impactFlags) {
      const entry = byFlag.get(flag) ?? { reasons: [], indexes: [] };
      const reason = `${change.entity}.${change.field}: ${change.reason}`;
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      entry.indexes.push(index);
      byFlag.set(flag, entry);
    }
  });

  return [...byFlag.entries()].map(([flag, entry]) => ({
    flag,
    reason: entry.reasons.join(" "),
    triggeredBy: entry.indexes,
  }));
}

export function highestSignificance(
  changes: readonly DetectedChange[]
): ProductChangeSignificance {
  if (changes.some((c) => c.significance === "CUSTOMS_SIGNIFICANT")) return "CUSTOMS_SIGNIFICANT";
  if (changes.some((c) => c.significance === "POTENTIALLY_CUSTOMS_SIGNIFICANT")) {
    return "POTENTIALLY_CUSTOMS_SIGNIFICANT";
  }
  return "NON_MATERIAL";
}
