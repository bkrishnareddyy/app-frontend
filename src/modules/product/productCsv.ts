/**
 * CSV import for the product master: parsing, column mapping, and row validation.
 *
 * Import is a three-step flow — upload and parse, validate and preview, commit —
 * and this module is the whole of the first two. It is pure: it turns text into
 * either a validated product input or a list of errors carrying the row and the
 * column, and it never writes anything. That means the preview a user approves
 * is produced by exactly the same code as the commit that follows it, so the
 * preview cannot promise something the commit does not do.
 *
 * The rules that matter:
 *
 *   - A bad row fails alone. One malformed weight does not reject a 4,000-row
 *     file, because the realistic import is 4,000 rows with 12 problems in it.
 *   - A classification column produces a CANDIDATE and nothing else. There is no
 *     status column, and adding one would not help: a spreadsheet cannot approve
 *     a tariff code.
 *   - A country column has to say which kind of country it is. `manufacture_country`
 *     and `origin_claim` are separate columns with separate meanings, and neither
 *     is derived from the other or from any party address in the file.
 */

import type { ProductIdentifierType } from "@prisma/client";
import {
  normalizeCountry,
  parseBoolean,
  parseDecimal,
  parsePercentage,
  trimToNull,
} from "./productNormalization";
import { checkClassificationCode } from "./productNormalization";
import { isKnownJurisdiction, isValidNomenclature, lookupUnit } from "./productVocabulary";
import { findAttributeDefinition } from "./productAttributes";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  headers: readonly string[];
  /** One entry per data row, already aligned to `headers` length. */
  rows: readonly (readonly string[])[];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * An RFC 4180 reader: quoted fields, doubled quotes inside them, embedded commas
 * and newlines. Written out rather than pulled in as a dependency because the
 * grammar is small and the failure modes of a loose split-on-comma — a product
 * description containing a comma silently shifting every column after it — are
 * exactly the kind of quiet corruption this system cannot have.
 *
 * A UTF-8 BOM is stripped: Excel writes one, and a header called "﻿sku"
 * matches nothing.
 */
export function parseCsv(text: string): ParsedCsv {
  const input = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let index = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      if (field !== "") {
        throw new CsvParseError(
          "A quoted field must start at the beginning of the field. Check for a stray double quote."
        );
      }
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRecord();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (inQuotes) {
    throw new CsvParseError("The file ends inside a quoted field. A closing double quote is missing.");
  }
  if (field !== "" || record.length > 0) endRecord();

  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) throw new CsvParseError("The file contains no rows.");

  const headers = (nonEmpty[0] ?? []).map((header) => header.trim());
  if (headers.every((header) => header === "")) {
    throw new CsvParseError("The first row must be a header row naming the columns.");
  }

  const rows = nonEmpty.slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");
    return padded.slice(0, headers.length);
  });

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export type ImportField =
  | "productName"
  | "internalSku"
  | "commercialDescription"
  | "technicalDescription"
  | "customsDescription"
  | "brand"
  | "model"
  | "manufacturerPartNumber"
  | "modelNumber"
  | "gtin"
  | "upc"
  | "ean"
  | "customerSku"
  | "supplierSku"
  | "manufactureCountry"
  | "productionCountry"
  | "originClaimCountry"
  | "classificationJurisdiction"
  | "classificationNomenclature"
  | "classificationCode"
  | "material"
  | "materialPercentage"
  | "compositionComplete";

interface ColumnDefinition {
  field: ImportField;
  /** Accepted header spellings, compared after lower-casing and de-punctuating. */
  aliases: readonly string[];
  label: string;
}

const COLUMN_DEFINITIONS: readonly ColumnDefinition[] = [
  { field: "productName", label: "Product name", aliases: ["product name", "name", "product", "description short"] },
  { field: "internalSku", label: "Internal SKU", aliases: ["internal sku", "sku", "item number", "item code", "part id"] },
  { field: "commercialDescription", label: "Commercial description", aliases: ["commercial description", "description", "invoice description"] },
  { field: "technicalDescription", label: "Technical description", aliases: ["technical description", "spec description", "engineering description"] },
  { field: "customsDescription", label: "Customs description", aliases: ["customs description", "entry description", "declared description"] },
  { field: "brand", label: "Brand", aliases: ["brand", "brand name", "make"] },
  { field: "model", label: "Model", aliases: ["model", "model name"] },
  { field: "manufacturerPartNumber", label: "Manufacturer part number", aliases: ["manufacturer part number", "mpn", "part number", "manufacturer part no"] },
  { field: "modelNumber", label: "Model number", aliases: ["model number", "model no"] },
  { field: "gtin", label: "GTIN", aliases: ["gtin", "gtin14", "global trade item number"] },
  { field: "upc", label: "UPC", aliases: ["upc", "upc code"] },
  { field: "ean", label: "EAN", aliases: ["ean", "ean13"] },
  { field: "customerSku", label: "Customer SKU", aliases: ["customer sku", "customer part number"] },
  { field: "supplierSku", label: "Supplier SKU", aliases: ["supplier sku", "vendor sku", "supplier part number"] },
  { field: "manufactureCountry", label: "Country of manufacture", aliases: ["country of manufacture", "manufacture country", "made in", "manufacturing country"] },
  { field: "productionCountry", label: "Country of production", aliases: ["country of production", "production country"] },
  { field: "originClaimCountry", label: "Claimed country of origin", aliases: ["country of origin", "origin", "origin claim", "claimed origin", "coo"] },
  { field: "classificationJurisdiction", label: "Classification jurisdiction", aliases: ["classification jurisdiction", "jurisdiction", "tariff jurisdiction", "destination country"] },
  { field: "classificationNomenclature", label: "Classification nomenclature", aliases: ["classification nomenclature", "nomenclature", "tariff schedule"] },
  { field: "classificationCode", label: "Classification code", aliases: ["classification code", "tariff code", "hs code", "hts code", "commodity code"] },
  { field: "material", label: "Material", aliases: ["material", "primary material", "composition material"] },
  { field: "materialPercentage", label: "Material percentage", aliases: ["material percentage", "material percent", "composition percentage"] },
  { field: "compositionComplete", label: "Composition is complete", aliases: ["composition complete", "complete composition", "full composition declared"] },
];

/** Header prefixes that address an attribute by code, e.g. `attribute:NET_WEIGHT`. */
const ATTRIBUTE_PREFIXES = ["attribute:", "attr:"];
const ATTRIBUTE_UNIT_PREFIXES = ["attribute_unit:", "attr_unit:"];

function canonicalHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const FIELD_BY_ALIAS: ReadonlyMap<string, ImportField> = new Map(
  COLUMN_DEFINITIONS.flatMap((definition) =>
    definition.aliases.map((alias) => [alias, definition.field] as const)
  )
);

export interface AttributeColumn {
  index: number;
  attributeCode: string;
  /** Column index holding this attribute's unit, when the file supplies one. */
  unitIndex: number | null;
}

export interface ColumnMapping {
  /** Field to column index. A field absent from the file is absent here. */
  fields: ReadonlyMap<ImportField, number>;
  attributes: readonly AttributeColumn[];
  /** Headers that matched nothing. Reported, never guessed at. */
  unmappedHeaders: readonly string[];
  /** Headers claiming the same field twice, which is ambiguous. */
  duplicateHeaders: readonly string[];
}

export function mapColumns(headers: readonly string[]): ColumnMapping {
  const fields = new Map<ImportField, number>();
  const attributes: AttributeColumn[] = [];
  const unitColumns = new Map<string, number>();
  const unmappedHeaders: string[] = [];
  const duplicateHeaders: string[] = [];

  headers.forEach((header, index) => {
    const canonical = canonicalHeader(header);
    if (canonical === "") return;

    const rawLower = header.trim().toLowerCase();

    const unitPrefix = ATTRIBUTE_UNIT_PREFIXES.find((prefix) => rawLower.startsWith(prefix));
    if (unitPrefix !== undefined) {
      unitColumns.set(attributeCodeFromHeader(rawLower.slice(unitPrefix.length)), index);
      return;
    }

    const attributePrefix = ATTRIBUTE_PREFIXES.find((prefix) => rawLower.startsWith(prefix));
    if (attributePrefix !== undefined) {
      attributes.push({
        index,
        attributeCode: attributeCodeFromHeader(rawLower.slice(attributePrefix.length)),
        unitIndex: null,
      });
      return;
    }

    const field = FIELD_BY_ALIAS.get(canonical);
    if (field === undefined) {
      unmappedHeaders.push(header);
      return;
    }
    if (fields.has(field)) {
      duplicateHeaders.push(header);
      return;
    }
    fields.set(field, index);
  });

  const resolved = attributes.map((attribute) => ({
    ...attribute,
    unitIndex: unitColumns.get(attribute.attributeCode) ?? null,
  }));

  return { fields, attributes: resolved, unmappedHeaders, duplicateHeaders };
}

function attributeCodeFromHeader(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export interface ImportRowError {
  /** The header the problem is in, or null for a whole-row problem. */
  column: string | null;
  message: string;
}

export interface ImportIdentifier {
  identifierType: ProductIdentifierType;
  value: string;
}

export interface ImportClassification {
  jurisdiction: string;
  nomenclature: string;
  classificationCode: string;
}

export interface ImportCountryFact {
  factType: "MANUFACTURE_COUNTRY" | "PRODUCTION_COUNTRY" | "ORIGIN_CLAIM";
  rawCountry: string;
  countryCode: string | null;
}

export interface ImportAttribute {
  attributeCode: string;
  rawValue: string;
  rawUnit: string | null;
}

export interface ImportComposition {
  material: string;
  percentage: number | null;
  isCompleteDeclaration: boolean;
}

export interface ImportProductRow {
  productName: string;
  internalSku: string | null;
  commercialDescription: string | null;
  technicalDescription: string | null;
  customsDescription: string | null;
  brand: string | null;
  model: string | null;
  identifiers: readonly ImportIdentifier[];
  attributes: readonly ImportAttribute[];
  compositions: readonly ImportComposition[];
  countryFacts: readonly ImportCountryFact[];
  /** Always created as CANDIDATE. A file cannot approve a classification. */
  classifications: readonly ImportClassification[];
}

export interface ImportRowResult {
  /** 1-based row number in the uploaded file, counting the header as row 1. */
  rowNumber: number;
  status: "VALID" | "INVALID";
  data: ImportProductRow | null;
  errors: readonly ImportRowError[];
  warnings: readonly ImportRowError[];
  /**
   * A canonical rendering of the row's meaningful content. The service hashes it
   * to make a re-uploaded file a no-op instead of a duplicate.
   */
  fingerprint: string;
}

export interface ImportValidationResult {
  mapping: ColumnMapping;
  rows: readonly ImportRowResult[];
  validCount: number;
  invalidCount: number;
  /** Problems with the file as a whole; when non-empty, no row was validated. */
  fileErrors: readonly ImportRowError[];
}

const IDENTIFIER_FIELDS: readonly (readonly [ImportField, ProductIdentifierType])[] = [
  ["internalSku", "INTERNAL_SKU"],
  ["manufacturerPartNumber", "MANUFACTURER_PART_NUMBER"],
  ["modelNumber", "MODEL_NUMBER"],
  ["gtin", "GTIN"],
  ["upc", "UPC"],
  ["ean", "EAN"],
  ["customerSku", "CUSTOMER_SKU"],
  ["supplierSku", "SUPPLIER_SKU"],
];

export function validateImport(parsed: ParsedCsv): ImportValidationResult {
  const mapping = mapColumns(parsed.headers);
  const fileErrors: ImportRowError[] = [];

  if (!mapping.fields.has("productName")) {
    fileErrors.push({
      column: null,
      message:
        "The file needs a product name column. Accepted headers: product_name, name, product.",
    });
  }
  for (const header of mapping.duplicateHeaders) {
    fileErrors.push({
      column: header,
      message: "Two columns map to the same field. Remove one so it is clear which value applies.",
    });
  }

  if (fileErrors.length > 0) {
    return { mapping, rows: [], validCount: 0, invalidCount: 0, fileErrors };
  }

  const rows = parsed.rows.map((row, index) =>
    validateRow(row, index + 2, parsed.headers, mapping)
  );

  return {
    mapping,
    rows,
    validCount: rows.filter((row) => row.status === "VALID").length,
    invalidCount: rows.filter((row) => row.status === "INVALID").length,
    fileErrors: [],
  };
}

function validateRow(
  row: readonly string[],
  rowNumber: number,
  headers: readonly string[],
  mapping: ColumnMapping
): ImportRowResult {
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];

  const cell = (field: ImportField): string | null => {
    const index = mapping.fields.get(field);
    if (index === undefined) return null;
    return trimToNull(row[index] ?? null);
  };
  const headerFor = (field: ImportField): string => {
    const index = mapping.fields.get(field);
    return index === undefined ? String(field) : (headers[index] ?? String(field));
  };

  const productName = cell("productName");
  if (productName === null) {
    errors.push({ column: headerFor("productName"), message: "A product name is required." });
  }

  const identifiers: ImportIdentifier[] = [];
  for (const [field, identifierType] of IDENTIFIER_FIELDS) {
    const value = cell(field);
    if (value !== null) identifiers.push({ identifierType, value });
  }

  const countryFacts: ImportCountryFact[] = [];
  const countryColumns: readonly (readonly [ImportField, ImportCountryFact["factType"]])[] = [
    ["manufactureCountry", "MANUFACTURE_COUNTRY"],
    ["productionCountry", "PRODUCTION_COUNTRY"],
    ["originClaimCountry", "ORIGIN_CLAIM"],
  ];
  for (const [field, factType] of countryColumns) {
    const value = cell(field);
    if (value === null) continue;
    const normalized = normalizeCountry(value);
    if (normalized.code === null) {
      warnings.push({
        column: headerFor(field),
        message: `"${value}" was not recognised as a country. The value is kept as written and left unresolved rather than guessed at.`,
      });
    }
    countryFacts.push({ factType, rawCountry: normalized.raw, countryCode: normalized.code });
  }

  const classifications: ImportClassification[] = [];
  const code = cell("classificationCode");
  const jurisdiction = cell("classificationJurisdiction");
  const nomenclature = cell("classificationNomenclature");

  if (code !== null) {
    if (jurisdiction === null) {
      errors.push({
        column: headerFor("classificationCode"),
        message:
          "A classification code needs a jurisdiction. The same digits mean different things in different tariffs, so a code on its own cannot be stored.",
      });
    } else {
      const upperJurisdiction = jurisdiction.toUpperCase();
      if (!isKnownJurisdiction(upperJurisdiction)) {
        errors.push({
          column: headerFor("classificationJurisdiction"),
          message: `"${jurisdiction}" is not a recognised jurisdiction. Use an ISO country code such as US, or a union code such as EU.`,
        });
      } else {
        const resolvedNomenclature = (nomenclature ?? defaultNomenclature(upperJurisdiction)).toUpperCase();
        if (!isValidNomenclature(upperJurisdiction, resolvedNomenclature)) {
          errors.push({
            column: headerFor("classificationNomenclature"),
            message: `${resolvedNomenclature} is not a nomenclature used by ${upperJurisdiction}.`,
          });
        } else {
          const check = checkClassificationCode(resolvedNomenclature, code);
          if (check.normalized === "") {
            errors.push({
              column: headerFor("classificationCode"),
              message: "A classification code must contain digits.",
            });
          } else if (!check.wellFormed) {
            errors.push({
              column: headerFor("classificationCode"),
              message: `${resolvedNomenclature} codes carry ${check.expectedLengths?.join(" or ") ?? "at least 6"} digits; "${code}" has ${check.normalized.length}.`,
            });
          } else {
            if (nomenclature === null) {
              warnings.push({
                column: headerFor("classificationCode"),
                message: `No nomenclature column was supplied, so ${resolvedNomenclature} was assumed for ${upperJurisdiction}. The code will be recorded as a candidate for review either way.`,
              });
            }
            classifications.push({
              jurisdiction: upperJurisdiction,
              nomenclature: resolvedNomenclature,
              classificationCode: code,
            });
          }
        }
      }
    }
  } else if (jurisdiction !== null || nomenclature !== null) {
    warnings.push({
      column: headerFor("classificationJurisdiction"),
      message: "A jurisdiction was supplied without a classification code, so no classification was created.",
    });
  }

  const attributes: ImportAttribute[] = [];
  for (const attributeColumn of mapping.attributes) {
    const rawValue = trimToNull(row[attributeColumn.index] ?? null);
    if (rawValue === null) continue;

    const header = headers[attributeColumn.index] ?? attributeColumn.attributeCode;
    const rawUnit =
      attributeColumn.unitIndex === null ? null : trimToNull(row[attributeColumn.unitIndex] ?? null);

    const definition = findAttributeDefinition(attributeColumn.attributeCode);
    if (definition === null) {
      warnings.push({
        column: header,
        message: `${attributeColumn.attributeCode} is not in the attribute catalogue. It is imported as written and treated as customs-significant, so changes to it will raise a revalidation signal.`,
      });
    } else {
      const problem = checkAttributeValue(definition.valueType, rawValue, definition.allowedValues);
      if (problem !== null) {
        errors.push({ column: header, message: problem });
        continue;
      }
      if (definition.unitDimension !== undefined && rawUnit !== null) {
        const unit = lookupUnit(rawUnit);
        if (unit === null) {
          warnings.push({
            column: header,
            message: `"${rawUnit}" is not a unit this system converts. The value is stored as written but cannot be compared against other records.`,
          });
        } else if (unit.dimension !== definition.unitDimension) {
          errors.push({
            column: header,
            message: `${definition.label} is measured in ${definition.unitDimension.toLowerCase()}, but "${rawUnit}" is a unit of ${unit.dimension.toLowerCase()}.`,
          });
          continue;
        }
      }
    }

    attributes.push({ attributeCode: attributeColumn.attributeCode, rawValue, rawUnit });
  }

  const compositions: ImportComposition[] = [];
  const material = cell("material");
  if (material !== null) {
    const percentageText = cell("materialPercentage");
    let percentage: number | null = null;
    if (percentageText !== null) {
      percentage = parsePercentage(percentageText);
      if (percentage === null) {
        errors.push({
          column: headerFor("materialPercentage"),
          message: `"${percentageText}" is not a percentage between 0 and 100.`,
        });
      }
    }
    const completeText = cell("compositionComplete");
    const complete = completeText === null ? false : parseBoolean(completeText);
    if (completeText !== null && complete === null) {
      errors.push({
        column: headerFor("compositionComplete"),
        message: `"${completeText}" is not a yes/no value.`,
      });
    }
    compositions.push({
      material,
      percentage,
      isCompleteDeclaration: complete === true,
    });
  } else if (cell("materialPercentage") !== null) {
    errors.push({
      column: headerFor("materialPercentage"),
      message: "A material percentage was supplied without a material.",
    });
  }

  const data: ImportProductRow | null =
    errors.length > 0 || productName === null
      ? null
      : {
          productName,
          internalSku: cell("internalSku"),
          commercialDescription: cell("commercialDescription"),
          technicalDescription: cell("technicalDescription"),
          customsDescription: cell("customsDescription"),
          brand: cell("brand"),
          model: cell("model"),
          identifiers,
          attributes,
          compositions,
          countryFacts,
          classifications,
        };

  return {
    rowNumber,
    status: errors.length > 0 ? "INVALID" : "VALID",
    data,
    errors,
    warnings,
    fingerprint: rowFingerprint(headers, row),
  };
}

/** The nomenclature assumed when a file gives a jurisdiction but not a schedule. */
function defaultNomenclature(jurisdiction: string): string {
  switch (jurisdiction) {
    case "US":
      return "HTSUS";
    case "EU":
      return "CN";
    case "CA":
      return "CUSTOMS_TARIFF";
    case "GB":
      return "UK_GLOBAL_TARIFF";
    case "MX":
      return "TIGIE";
    default:
      return "HS";
  }
}

function checkAttributeValue(
  valueType: string,
  rawValue: string,
  allowedValues: readonly string[] | undefined
): string | null {
  switch (valueType) {
    case "NUMBER":
      return parseDecimal(rawValue) === null ? `"${rawValue}" is not a number.` : null;
    case "BOOLEAN":
      return parseBoolean(rawValue) === null ? `"${rawValue}" is not a yes/no value.` : null;
    case "ENUM": {
      if (allowedValues === undefined) return null;
      const upper = rawValue.trim().toUpperCase().replace(/[\s-]+/g, "_");
      return allowedValues.includes(upper)
        ? null
        : `"${rawValue}" is not one of: ${allowedValues.join(", ")}.`;
    }
    default:
      return null;
  }
}

/**
 * A stable rendering of a row, independent of column order.
 *
 * Used for idempotency: the same row in a re-uploaded file produces the same
 * fingerprint, so a repeated import updates nothing rather than creating a
 * second copy of every product. Blank cells are dropped so that adding an empty
 * column to a spreadsheet does not make every row look new.
 */
export function rowFingerprint(headers: readonly string[], row: readonly string[]): string {
  return headers
    .map((header, index) => [canonicalHeader(header), (row[index] ?? "").trim()] as const)
    .filter(([header, value]) => header !== "" && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([header, value]) => `${header}=${value}`)
    .join("");
}

/** The template offered on the import screen, so a user starts from a valid file. */
export const IMPORT_TEMPLATE_HEADERS: readonly string[] = [
  "product_name",
  "internal_sku",
  "commercial_description",
  "technical_description",
  "customs_description",
  "brand",
  "model",
  "manufacturer_part_number",
  "gtin",
  "country_of_manufacture",
  "country_of_origin",
  "classification_jurisdiction",
  "classification_nomenclature",
  "classification_code",
  "material",
  "material_percentage",
  "attribute:PRIMARY_MATERIAL",
  "attribute:NET_WEIGHT",
  "attribute_unit:NET_WEIGHT",
];

export function importTemplateCsv(): string {
  const example = [
    "Industrial pressure sensor",
    "SKU-10045",
    "Pressure sensor, stainless steel housing",
    "Piezoresistive pressure transducer, 0-10 bar, 24 VDC",
    "Electrical apparatus for measuring pressure",
    "Acme",
    "PS-2200",
    "PS2200-A",
    "00012345678905",
    "DE",
    "DE",
    "US",
    "HTSUS",
    "9026.20.4000",
    "Stainless steel",
    "62",
    "Stainless steel",
    "0.42",
    "kg",
  ];
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `${IMPORT_TEMPLATE_HEADERS.join(",")}\n${example.map(quote).join(",")}\n`;
}
