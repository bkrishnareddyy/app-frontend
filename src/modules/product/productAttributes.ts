/**
 * The product attribute catalogue.
 *
 * Attributes are the physical and functional facts about a product that a
 * classifier or an origin analyst actually asks for: what it is made of, what it
 * weighs, what it does, how it is presented for sale. They live in a catalogue
 * rather than as columns because the useful set differs completely between a
 * textile and a semiconductor, and because customs-significance is a property of
 * the attribute, not of the row.
 *
 * This is a code-level catalogue, deliberately. A tenant-editable attribute
 * schema would be a PIM feature — dynamic definitions, per-account validation
 * rules, a UI to manage them — and building a half version of that would be
 * worse than not building it. What is here covers the fields the classification
 * and origin workflows reference today, and `ProductAttribute` stores
 * `attributeCode` as a plain string so an uncatalogued code is recorded rather
 * than rejected.
 *
 * `customsSignificant` is the field that matters most. It is what makes changing
 * a product's material composition raise a revalidation signal while changing
 * its marketing colour does not.
 */

import type { ProductAttributeValueType } from "@prisma/client";

export const ATTRIBUTE_GROUPS = [
  "PHYSICAL",
  "MATERIAL",
  "FUNCTIONAL",
  "ELECTRICAL",
  "COMMERCIAL",
  "PACKAGING",
  "REGULATORY",
] as const;

export type AttributeGroup = (typeof ATTRIBUTE_GROUPS)[number];

export interface ProductAttributeDefinition {
  code: string;
  label: string;
  group: AttributeGroup;
  valueType: ProductAttributeValueType;
  /**
   * Whether a change to this attribute can change a customs outcome. Drives
   * change significance and therefore revalidation signals.
   */
  customsSignificant: boolean;
  /** Canonical unit dimension, where the attribute carries one. */
  unitDimension?: string;
  /** Allowed values, for ENUM attributes. */
  allowedValues?: readonly string[];
  /** Why this attribute matters, shown as help text in the UI. */
  guidance?: string;
}

export const PRODUCT_ATTRIBUTE_DEFINITIONS: readonly ProductAttributeDefinition[] = [
  {
    code: "NET_WEIGHT",
    label: "Net weight",
    group: "PHYSICAL",
    valueType: "NUMBER",
    unitDimension: "MASS",
    customsSignificant: true,
    guidance: "Weight of the goods alone. Several tariff headings and most specific duty rates key off it.",
  },
  {
    code: "GROSS_WEIGHT",
    label: "Gross weight",
    group: "PHYSICAL",
    valueType: "NUMBER",
    unitDimension: "MASS",
    customsSignificant: false,
    guidance: "Weight including packaging. Recorded for logistics; rarely classification-relevant.",
  },
  {
    code: "LENGTH",
    label: "Length",
    group: "PHYSICAL",
    valueType: "NUMBER",
    unitDimension: "LENGTH",
    customsSignificant: false,
  },
  {
    code: "WIDTH",
    label: "Width",
    group: "PHYSICAL",
    valueType: "NUMBER",
    unitDimension: "LENGTH",
    customsSignificant: false,
  },
  {
    code: "HEIGHT",
    label: "Height",
    group: "PHYSICAL",
    valueType: "NUMBER",
    unitDimension: "LENGTH",
    customsSignificant: false,
  },
  {
    code: "VOLUME",
    label: "Volume",
    group: "PHYSICAL",
    valueType: "NUMBER",
    unitDimension: "VOLUME",
    customsSignificant: true,
    guidance: "Classification-relevant for liquids and for goods graded by capacity.",
  },
  {
    code: "PRIMARY_MATERIAL",
    label: "Primary material",
    group: "MATERIAL",
    valueType: "STRING",
    customsSignificant: true,
    guidance: "The material giving the product its essential character. Drives classification directly.",
  },
  {
    code: "SURFACE_TREATMENT",
    label: "Surface treatment",
    group: "MATERIAL",
    valueType: "STRING",
    customsSignificant: true,
    guidance: "Plating, coating, or finish. Distinguishes headings within several metal chapters.",
  },
  {
    code: "PROCESSING_STATE",
    label: "Processing state",
    group: "MATERIAL",
    valueType: "ENUM",
    customsSignificant: true,
    allowedValues: ["RAW", "SEMI_FINISHED", "FINISHED", "ASSEMBLED", "KIT", "PARTS"],
    guidance: "How far the goods are worked. Separates parts from finished articles.",
  },
  {
    code: "INTENDED_USE",
    label: "Intended use",
    group: "FUNCTIONAL",
    valueType: "STRING",
    customsSignificant: true,
    guidance: "What the product is for. Several headings are use-based rather than material-based.",
  },
  {
    code: "FUNCTION",
    label: "Principal function",
    group: "FUNCTIONAL",
    valueType: "STRING",
    customsSignificant: true,
    guidance: "What the product does. Decisive for composite machines and multi-function goods.",
  },
  {
    code: "END_USER_TYPE",
    label: "End user type",
    group: "FUNCTIONAL",
    valueType: "ENUM",
    customsSignificant: true,
    allowedValues: ["CONSUMER", "INDUSTRIAL", "MEDICAL", "MILITARY", "LABORATORY", "AGRICULTURAL"],
    guidance: "Who the goods are made for. Can pull a product into a controlled category.",
  },
  {
    code: "POWERED",
    label: "Powered",
    group: "ELECTRICAL",
    valueType: "BOOLEAN",
    customsSignificant: true,
    guidance: "Whether the product draws power. Splits many headings between powered and non-powered.",
  },
  {
    code: "VOLTAGE",
    label: "Voltage",
    group: "ELECTRICAL",
    valueType: "NUMBER",
    unitDimension: "VOLTAGE",
    customsSignificant: true,
    guidance: "Rated voltage. Threshold values separate subheadings in chapter 85.",
  },
  {
    code: "POWER_RATING",
    label: "Power rating",
    group: "ELECTRICAL",
    valueType: "NUMBER",
    unitDimension: "POWER",
    customsSignificant: true,
  },
  {
    code: "BATTERY_TYPE",
    label: "Battery type",
    group: "ELECTRICAL",
    valueType: "STRING",
    customsSignificant: true,
    guidance: "Cell chemistry, where a battery is included. Carries its own regulatory obligations.",
  },
  {
    code: "BRAND_NAME",
    label: "Brand name",
    group: "COMMERCIAL",
    valueType: "STRING",
    customsSignificant: false,
  },
  {
    code: "COLOUR",
    label: "Colour",
    group: "COMMERCIAL",
    valueType: "STRING",
    customsSignificant: false,
  },
  {
    code: "RETAIL_PACKAGED",
    label: "Put up for retail sale",
    group: "PACKAGING",
    valueType: "BOOLEAN",
    customsSignificant: true,
    guidance: "Whether the goods are packaged for retail. Decides the treatment of sets under GRI 3(b).",
  },
  {
    code: "PACKAGING_TYPE",
    label: "Packaging type",
    group: "PACKAGING",
    valueType: "STRING",
    customsSignificant: false,
  },
  {
    code: "UNIT_OF_MEASURE",
    label: "Commercial unit of measure",
    group: "COMMERCIAL",
    valueType: "STRING",
    customsSignificant: false,
  },
  {
    code: "HAZMAT",
    label: "Hazardous material",
    group: "REGULATORY",
    valueType: "BOOLEAN",
    customsSignificant: true,
    guidance: "Whether the goods are regulated as hazardous. Changes documentary requirements.",
  },
  {
    code: "UN_NUMBER",
    label: "UN number",
    group: "REGULATORY",
    valueType: "STRING",
    customsSignificant: true,
  },
  {
    code: "CONTAINS_WOOD_PACKAGING",
    label: "Contains wood packaging",
    group: "REGULATORY",
    valueType: "BOOLEAN",
    customsSignificant: true,
    guidance: "Triggers phytosanitary treatment requirements in most jurisdictions.",
  },
];

const BY_CODE: ReadonlyMap<string, ProductAttributeDefinition> = new Map(
  PRODUCT_ATTRIBUTE_DEFINITIONS.map((definition) => [definition.code, definition])
);

export function findAttributeDefinition(code: string): ProductAttributeDefinition | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/**
 * Whether an attribute code is customs-significant.
 *
 * An uncatalogued code is treated as significant. The catalogue cannot know what
 * a tenant added, and treating an unknown fact as harmless would let a
 * customs-relevant change pass without a revalidation signal — the failure that
 * matters here is the silent one.
 */
export function isAttributeCustomsSignificant(code: string): boolean {
  const definition = findAttributeDefinition(code);
  return definition === null ? true : definition.customsSignificant;
}

export function attributesByGroup(): Map<AttributeGroup, ProductAttributeDefinition[]> {
  const grouped = new Map<AttributeGroup, ProductAttributeDefinition[]>();
  for (const group of ATTRIBUTE_GROUPS) grouped.set(group, []);
  for (const definition of PRODUCT_ATTRIBUTE_DEFINITIONS) {
    grouped.get(definition.group)?.push(definition);
  }
  return grouped;
}
