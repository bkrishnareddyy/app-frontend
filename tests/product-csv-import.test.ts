import { describe, expect, it } from "vitest";
import {
  CsvParseError,
  IMPORT_TEMPLATE_HEADERS,
  hasCsvExtension,
  importTemplateCsv,
  mapColumns,
  parseCsv,
  rowFingerprint,
  validateImport,
} from "@/modules/product/productCsv";

const validate = (csv: string) => validateImport(parseCsv(csv));
const firstRow = (csv: string) => validate(csv).rows[0]!;

describe("parseCsv", () => {
  it("keeps a comma inside a quoted field in that field", () => {
    // A loose split on commas shifts every column after a description containing
    // one, which corrupts a file silently rather than rejecting it.
    const parsed = parseCsv('name,description\n"Bracket, heavy",Steel\n');
    expect(parsed.rows[0]).toEqual(["Bracket, heavy", "Steel"]);
  });

  it("reads doubled quotes and embedded newlines", () => {
    const parsed = parseCsv('name,note\n"6"" pipe","line one\nline two"\n');
    expect(parsed.rows[0]).toEqual(['6" pipe', "line one\nline two"]);
  });

  it("strips the byte-order mark Excel writes", () => {
    const parsed = parseCsv("﻿sku,name\nA1,Bracket\n");
    expect(parsed.headers[0]).toBe("sku");
  });

  it("pads a short row rather than shifting its values", () => {
    const parsed = parseCsv("name,brand,model\nBracket,Acme\n");
    expect(parsed.rows[0]).toEqual(["Bracket", "Acme", ""]);
  });

  it("refuses a file that ends inside a quoted field", () => {
    expect(() => parseCsv('name\n"unterminated\n')).toThrow(CsvParseError);
  });

  it("refuses an empty file", () => {
    expect(() => parseCsv("\n\n")).toThrow(CsvParseError);
  });
});

describe("hasCsvExtension", () => {
  it("accepts a .csv file name", () => {
    expect(hasCsvExtension("products.csv")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasCsvExtension("Products.CSV")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(hasCsvExtension("  products.csv  ")).toBe(true);
  });

  it("rejects a non-CSV extension", () => {
    expect(hasCsvExtension("products.xlsx")).toBe(false);
  });

  it("rejects a file name with no extension", () => {
    expect(hasCsvExtension("products")).toBe(false);
  });

  it("rejects a name that merely contains csv, not ending in it", () => {
    expect(hasCsvExtension("products.csv.pdf")).toBe(false);
  });
});

describe("mapColumns", () => {
  it("accepts the header spellings a real spreadsheet uses", () => {
    const mapping = mapColumns(["Product Name", "HS Code", "Country of Origin", "MPN"]);
    expect(mapping.fields.has("productName")).toBe(true);
    expect(mapping.fields.has("classificationCode")).toBe(true);
    expect(mapping.fields.has("originClaimCountry")).toBe(true);
    expect(mapping.fields.has("manufacturerPartNumber")).toBe(true);
  });

  it("keeps country of manufacture and country of origin as different columns", () => {
    const mapping = mapColumns(["product_name", "made in", "country of origin"]);
    expect(mapping.fields.get("manufactureCountry")).toBe(1);
    expect(mapping.fields.get("originClaimCountry")).toBe(2);
    expect(mapping.fields.get("manufactureCountry")).not.toBe(
      mapping.fields.get("originClaimCountry")
    );
  });

  it("reports an unrecognised header instead of guessing at it", () => {
    const mapping = mapColumns(["product_name", "widget_weight_thing"]);
    expect(mapping.unmappedHeaders).toEqual(["widget_weight_thing"]);
  });

  it("reads an attribute column and its unit column together", () => {
    const mapping = mapColumns(["product_name", "attribute:net_weight", "attribute_unit:net_weight"]);
    expect(mapping.attributes).toEqual([
      { index: 1, attributeCode: "NET_WEIGHT", unitIndex: 2 },
    ]);
  });

  it("treats two columns claiming one field as ambiguous", () => {
    const mapping = mapColumns(["product_name", "sku", "item_number"]);
    expect(mapping.duplicateHeaders).toEqual(["item_number"]);
  });
});

describe("validateImport: the file as a whole", () => {
  it("refuses a file with no product name column and validates no rows", () => {
    const result = validate("sku,brand\nA1,Acme\n");
    expect(result.fileErrors).toHaveLength(1);
    expect(result.rows).toEqual([]);
  });

  it("refuses an ambiguous file rather than picking a column", () => {
    const result = validate("product_name,sku,item_number\nBracket,A1,A2\n");
    expect(result.fileErrors.some((e) => e.column === "item_number")).toBe(true);
  });

  it("numbers rows as they appear in the spreadsheet, header included", () => {
    const result = validate("product_name\nA\nB\n");
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });
});

describe("validateImport: classifications", () => {
  it("refuses a tariff code with no jurisdiction", () => {
    const row = firstRow("product_name,hs_code\nBracket,8471300000\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("needs a jurisdiction");
  });

  it("accepts a code with its jurisdiction and records it, never approved", () => {
    const row = firstRow("product_name,jurisdiction,hs_code\nBracket,US,8471.30.01.00\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.classifications).toEqual([
      { jurisdiction: "US", nomenclature: "HTSUS", classificationCode: "8471.30.01.00" },
    ]);
  });

  it("says out loud which nomenclature it assumed", () => {
    const row = firstRow("product_name,jurisdiction,hs_code\nBracket,US,8471300100\n");
    expect(row.warnings.some((w) => w.message.includes("HTSUS was assumed"))).toBe(true);
  });

  it("refuses a jurisdiction it does not know", () => {
    const row = firstRow("product_name,jurisdiction,hs_code\nBracket,Narnia,8471300100\n");
    expect(row.status).toBe("INVALID");
  });

  it("refuses a code of the wrong length for its nomenclature", () => {
    const row = firstRow("product_name,jurisdiction,nomenclature,hs_code\nBracket,US,HTSUS,8471\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("digits");
  });

  it("does not invent a classification from a jurisdiction alone", () => {
    const row = firstRow("product_name,jurisdiction\nBracket,US\n");
    expect(row.data?.classifications).toEqual([]);
    expect(row.warnings.some((w) => w.message.includes("no classification was created"))).toBe(true);
  });

  it("has no column by which a file could assert an approved status", () => {
    // The importer's field list is closed. There is no "status" or "approved"
    // column, so a spreadsheet cannot claim a review that never happened.
    const mapping = mapColumns(["product_name", "status", "approved", "classification_status"]);
    expect(mapping.unmappedHeaders).toEqual(["status", "approved", "classification_status"]);
  });
});

describe("validateImport: country facts", () => {
  it("keeps manufacture country and origin claim as separate facts", () => {
    const row = firstRow("product_name,made in,country of origin\nBracket,China,Vietnam\n");
    expect(row.data?.countryFacts).toEqual([
      { factType: "MANUFACTURE_COUNTRY", rawCountry: "China", countryCode: "CN" },
      { factType: "ORIGIN_CLAIM", rawCountry: "Vietnam", countryCode: "VN" },
    ]);
  });

  it("does not derive an origin claim from a country of manufacture", () => {
    const row = firstRow("product_name,made in\nBracket,China\n");
    expect(row.data?.countryFacts.map((fact) => fact.factType)).toEqual(["MANUFACTURE_COUNTRY"]);
  });

  it("keeps an unrecognised country as written and warns, instead of guessing", () => {
    const row = firstRow("product_name,country of origin\nBracket,Republic of Somewhere\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.countryFacts[0]).toEqual({
      factType: "ORIGIN_CLAIM",
      rawCountry: "Republic of Somewhere",
      countryCode: null,
    });
    expect(row.warnings[0]?.message).toContain("not recognised as a country");
  });
});

describe("validateImport: attributes and composition", () => {
  it("rejects a value of the wrong type for a catalogued attribute", () => {
    const row = firstRow("product_name,attribute:net_weight\nBracket,heavy\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("not a number");
  });

  it("rejects a unit from the wrong dimension", () => {
    const row = firstRow(
      "product_name,attribute:net_weight,attribute_unit:net_weight\nBracket,2,litres\n"
    );
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("mass");
  });

  it("imports an uncatalogued attribute, warning that it counts as significant", () => {
    const row = firstRow("product_name,attribute:tenant_field\nBracket,yes\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.attributes[0]?.attributeCode).toBe("TENANT_FIELD");
    expect(row.warnings[0]?.message).toContain("customs-significant");
  });

  it("refuses a percentage with no material", () => {
    const row = firstRow("product_name,material percentage\nBracket,60\n");
    expect(row.status).toBe("INVALID");
  });

  it("defaults a composition to not-a-complete-declaration", () => {
    const row = firstRow("product_name,material,material percentage\nBracket,Steel,60\n");
    expect(row.data?.compositions[0]).toEqual({
      material: "Steel",
      percentage: 60,
      isCompleteDeclaration: false,
    });
  });
});

describe("validateImport: a bad row does not sink the file", () => {
  it("marks one row invalid and leaves the rest valid", () => {
    const result = validate(
      "product_name,jurisdiction,hs_code\nGood,US,8471300100\n,US,8471300100\nAlso good,US,8471300100\n"
    );
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.rows[1]?.rowNumber).toBe(3);
  });

  it("carries no data for an invalid row", () => {
    const result = validate("product_name,hs_code\nBracket,8471300100\n");
    expect(result.rows[0]?.data).toBeNull();
  });
});

describe("rowFingerprint", () => {
  it("is stable across column order", () => {
    expect(rowFingerprint(["sku", "name"], ["A1", "Bracket"])).toBe(
      rowFingerprint(["name", "sku"], ["Bracket", "A1"])
    );
  });

  it("ignores an added empty column and surrounding whitespace", () => {
    expect(rowFingerprint(["sku", "name", "spare"], [" A1 ", "Bracket", ""])).toBe(
      rowFingerprint(["sku", "name"], ["A1", "Bracket"])
    );
  });

  it("changes when a value changes", () => {
    expect(rowFingerprint(["sku"], ["A1"])).not.toBe(rowFingerprint(["sku"], ["A2"]));
  });
});

describe("the import template", () => {
  it("parses, validates as a file, and maps every one of its own headers", () => {
    const result = validate(importTemplateCsv());
    expect(result.fileErrors).toEqual([]);
    expect(result.mapping.unmappedHeaders).toEqual([]);
  });

  it("offers separate columns for manufacture country and origin claim", () => {
    const headers = IMPORT_TEMPLATE_HEADERS.map((header) => header.toLowerCase());
    expect(headers.some((header) => header.includes("manufacture"))).toBe(true);
    expect(headers.some((header) => header.includes("origin"))).toBe(true);
  });

  it("offers no column for approving anything", () => {
    for (const header of IMPORT_TEMPLATE_HEADERS) {
      expect(header.toLowerCase()).not.toContain("approv");
      expect(header.toLowerCase()).not.toContain("status");
    }
  });
});
