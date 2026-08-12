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
} from "@/modules/party/partyCsv";

const validate = (csv: string) => validateImport(parseCsv(csv));
const firstRow = (csv: string) => validate(csv).rows[0]!;

describe("parseCsv", () => {
  it("keeps a comma inside a quoted field in that field", () => {
    const parsed = parseCsv('legal_name,note\n"Acme, Global",Supplier\n');
    expect(parsed.rows[0]).toEqual(["Acme, Global", "Supplier"]);
  });

  it("reads doubled quotes and embedded newlines", () => {
    const parsed = parseCsv('legal_name,note\n"Acme ""Trading""","line one\nline two"\n');
    expect(parsed.rows[0]).toEqual(['Acme "Trading"', "line one\nline two"]);
  });

  it("strips the byte-order mark Excel writes", () => {
    const parsed = parseCsv("﻿legal_name,vat\nAcme,DE123\n");
    expect(parsed.headers[0]).toBe("legal_name");
  });

  it("pads a short row rather than shifting its values", () => {
    const parsed = parseCsv("legal_name,vat,eori\nAcme,DE123\n");
    expect(parsed.rows[0]).toEqual(["Acme", "DE123", ""]);
  });

  it("refuses a file that ends inside a quoted field", () => {
    expect(() => parseCsv('legal_name\n"unterminated\n')).toThrow(CsvParseError);
  });

  it("refuses an empty file", () => {
    expect(() => parseCsv("\n\n")).toThrow(CsvParseError);
  });
});

describe("hasCsvExtension", () => {
  it("accepts a .csv file name", () => {
    expect(hasCsvExtension("parties.csv")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasCsvExtension("Parties.CSV")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(hasCsvExtension("  parties.csv  ")).toBe(true);
  });

  it("rejects a non-CSV extension", () => {
    expect(hasCsvExtension("parties.xlsx")).toBe(false);
  });

  it("rejects a file name with no extension", () => {
    expect(hasCsvExtension("parties")).toBe(false);
  });

  it("rejects a name that merely contains csv, not ending in it", () => {
    expect(hasCsvExtension("parties.csv.pdf")).toBe(false);
  });
});

describe("mapColumns", () => {
  it("accepts the header spellings a real spreadsheet uses", () => {
    const mapping = mapColumns(["Legal Name", "VAT Number", "Registration Country", "Customer No"]);
    expect(mapping.fields.has("legalName")).toBe(true);
    expect(mapping.fields.has("vat")).toBe(true);
    expect(mapping.fields.has("registrationCountry")).toBe(true);
    expect(mapping.fields.has("customerNumber")).toBe(true);
  });

  it("keeps registration country and address country as different columns", () => {
    const mapping = mapColumns(["legal_name", "registration country", "country"]);
    expect(mapping.fields.get("registrationCountry")).toBe(1);
    expect(mapping.fields.get("addressCountry")).toBe(2);
    expect(mapping.fields.get("registrationCountry")).not.toBe(mapping.fields.get("addressCountry"));
  });

  it("reports an unrecognised header instead of guessing at it", () => {
    const mapping = mapColumns(["legal_name", "widget_weight_thing"]);
    expect(mapping.unmappedHeaders).toEqual(["widget_weight_thing"]);
  });

  it("treats two columns claiming one field as ambiguous", () => {
    const mapping = mapColumns(["legal_name", "vat", "vat number"]);
    expect(mapping.duplicateHeaders).toEqual(["vat number"]);
  });

  it("has no column by which a file could assert a review or verification status", () => {
    const mapping = mapColumns(["legal_name", "review_status", "approved", "verified"]);
    expect(mapping.unmappedHeaders).toEqual(["review_status", "approved", "verified"]);
  });
});

describe("validateImport: the file as a whole", () => {
  it("refuses a file with no legal name column and validates no rows", () => {
    const result = validate("sku,brand\nA1,Acme\n");
    expect(result.fileErrors).toHaveLength(1);
    expect(result.rows).toEqual([]);
  });

  it("refuses an ambiguous file rather than picking a column", () => {
    const result = validate("legal_name,vat,vat number\nAcme,V1,V2\n");
    expect(result.fileErrors.some((e) => e.column === "vat number")).toBe(true);
  });

  it("numbers rows as they appear in the spreadsheet, header included", () => {
    const result = validate("legal_name\nA\nB\n");
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });
});

describe("validateImport: registrations", () => {
  it("refuses a registration number with no country", () => {
    const row = firstRow("legal_name,registration_number\nAcme,HRB1\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("registration country");
  });

  it("accepts a number with its country and records it, never verified", () => {
    const row = firstRow("legal_name,registration_number,registration_country\nAcme,HRB1,DE\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.registration).toEqual({
      registrationNumber: "HRB1",
      country: "DE",
      registeringAuthority: null,
      legalForm: null,
    });
  });

  it("keeps an unrecognised country as written and warns, instead of guessing", () => {
    const row = firstRow("legal_name,registration_number,registration_country\nAcme,HRB1,Narnia\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.registration?.country).toBe("Narnia");
    expect(row.warnings[0]?.message).toContain("not recognised as a country");
  });

  it("warns and creates nothing when a country is supplied with no registration number", () => {
    const row = firstRow("legal_name,registration_country\nAcme,DE\n");
    expect(row.data?.registration).toBeNull();
    expect(row.warnings[0]?.message).toContain("without a registration number");
  });
});

describe("validateImport: addresses", () => {
  it("refuses an address line with no country", () => {
    const row = firstRow("legal_name,address_line_1\nAcme,1 Main St\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("needs a country");
  });

  it("accepts an address line with its country", () => {
    const row = firstRow("legal_name,address_line_1,address_country\nAcme,1 Main St,DE\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.address?.addressLine1).toBe("1 Main St");
    expect(row.data?.address?.country).toBe("DE");
  });

  it("keeps an unrecognised address country as written and warns", () => {
    const row = firstRow("legal_name,address_line_1,address_country\nAcme,1 Main St,Narnia\n");
    expect(row.data?.address?.country).toBe("Narnia");
    expect(row.warnings[0]?.message).toContain("not recognised as a country");
  });

  it("warns and creates nothing when a country is supplied with no address line", () => {
    const row = firstRow("legal_name,address_country\nAcme,DE\n");
    expect(row.data?.address).toBeNull();
    expect(row.warnings[0]?.message).toContain("without an address line");
  });
});

describe("validateImport: contact", () => {
  it("rejects a contact email that is not an email address", () => {
    const row = firstRow("legal_name,contact_email\nAcme,not-an-email\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("is not an email address");
  });

  it("accepts a well-formed contact", () => {
    const row = firstRow("legal_name,contact_name,contact_email\nAcme,Jonas Weber,jonas@acme.example\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.contact).toEqual({ name: "Jonas Weber", email: "jonas@acme.example", phone: null });
  });
});

describe("validateImport: roles", () => {
  it("rejects a role it does not recognise", () => {
    const row = firstRow("legal_name,roles\nAcme,SPACE_PIRATE\n");
    expect(row.status).toBe("INVALID");
    expect(row.errors[0]?.message).toContain("is not a recognised role");
  });

  it("accepts several roles separated by ; or /", () => {
    const row = firstRow("legal_name,roles\nAcme,SUPPLIER;MANUFACTURER/CARRIER\n");
    expect(row.status).toBe("VALID");
    expect(row.data?.roleTypes).toEqual(["SUPPLIER", "MANUFACTURER", "CARRIER"]);
  });
});

describe("validateImport: a bad row does not sink the file", () => {
  it("marks one row invalid and leaves the rest valid", () => {
    const result = validate(
      "legal_name,registration_number,registration_country\nGood,HRB1,DE\n,HRB2,DE\nAlso good,HRB3,DE\n"
    );
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.rows[1]?.rowNumber).toBe(3);
  });

  it("carries no data for an invalid row", () => {
    const result = validate("legal_name,registration_number\nAcme,HRB1\n");
    expect(result.rows[0]?.data).toBeNull();
  });
});

describe("rowFingerprint", () => {
  it("is stable across column order", () => {
    expect(rowFingerprint(["vat", "legal_name"], ["V1", "Acme"])).toBe(
      rowFingerprint(["legal_name", "vat"], ["Acme", "V1"])
    );
  });

  it("ignores an added empty column and surrounding whitespace", () => {
    expect(rowFingerprint(["legal_name", "vat", "spare"], [" Acme ", "V1", ""])).toBe(
      rowFingerprint(["legal_name", "vat"], ["Acme", "V1"])
    );
  });

  it("changes when a value changes", () => {
    expect(rowFingerprint(["legal_name"], ["Acme"])).not.toBe(rowFingerprint(["legal_name"], ["Acme Global"]));
  });
});

describe("the import template", () => {
  it("parses, validates as a file, and maps every one of its own headers", () => {
    const result = validate(importTemplateCsv());
    expect(result.fileErrors).toEqual([]);
    expect(result.mapping.unmappedHeaders).toEqual([]);
  });

  it("offers separate columns for registration country and address country", () => {
    const headers = IMPORT_TEMPLATE_HEADERS.map((h) => h.toLowerCase());
    expect(headers.some((h) => h.includes("registration_country"))).toBe(true);
    expect(headers.some((h) => h.includes("address_country"))).toBe(true);
  });

  it("offers no column for approving or verifying anything", () => {
    for (const header of IMPORT_TEMPLATE_HEADERS) {
      expect(header.toLowerCase()).not.toContain("approv");
      expect(header.toLowerCase()).not.toContain("verif");
      expect(header.toLowerCase()).not.toContain("status");
    }
  });
});
