/**
 * CSV import for the party master: parsing, column mapping, and row validation.
 *
 * Mirrors `productCsv.ts` exactly in shape and rationale — the same reader, the
 * same alias-based column mapping, the same "a bad row fails alone" rule — so
 * a user who has imported products already recognises this screen. Only the
 * columns differ: a party row can carry one legal name, any number of
 * identifiers, at most one registration, one address, one contact, and any
 * number of roles.
 *
 * The rules that matter for parties specifically:
 *
 *   - A registration number without a country is rejected, not guessed at.
 *     "12345678" is a different fact in every jurisdiction that issues it.
 *   - Every fact this produces is created with `sourceType: "IMPORT"` and
 *     status CLAIMED/ACTIVE — never VERIFIED, never APPROVED. A spreadsheet
 *     cannot verify a registration any more than it can approve a tariff code.
 *   - Rows are matched against the existing party master before anything is
 *     written (in `partyImportService.ts`), so re-uploading the same file
 *     updates nothing rather than creating duplicate parties.
 */

import type { PartyIdentifierType, PartyRoleType } from "@prisma/client";
import { normalizeCountry, trimToNull } from "./partyNormalization";

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
 * Whether a browser-reported file name looks like a CSV export, not a rename
 * of some other file type. This is not a content sniff — a `.csv`-named file
 * can still fail to parse, and that failure is reported on its own terms by
 * `parseCsv`. What this catches is the file a user picked with "All Files"
 * and never meant to be read as a spreadsheet: a `.xlsx`, a `.pdf`, an image.
 * Those decode to garbled text and would otherwise fail as an opaque "missing
 * legal name column" error instead of the specific problem it actually is.
 */
export function hasCsvExtension(fileName: string): boolean {
  return /\.csv$/i.test(fileName.trim());
}

/**
 * An RFC 4180 reader: quoted fields, doubled quotes inside them, embedded
 * commas and newlines. Identical to `parseCsv` in `productCsv.ts` — the
 * grammar does not vary by what the rows describe.
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
  | "legalName"
  | "tradeName"
  | "internalPartyCode"
  | "partyKind"
  | "eori"
  | "duns"
  | "lei"
  | "vat"
  | "taxId"
  | "customsId"
  | "customerNumber"
  | "supplierNumber"
  | "registrationNumber"
  | "registrationCountry"
  | "registeringAuthority"
  | "legalForm"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "stateProvince"
  | "postalCode"
  | "addressCountry"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "roleTypes";

interface ColumnDefinition {
  field: ImportField;
  /** Accepted header spellings, compared after lower-casing and de-punctuating. */
  aliases: readonly string[];
  label: string;
}

const COLUMN_DEFINITIONS: readonly ColumnDefinition[] = [
  { field: "legalName", label: "Legal name", aliases: ["legal name", "party name", "name", "company name"] },
  { field: "tradeName", label: "Trade name", aliases: ["trade name", "dba", "trading as", "doing business as"] },
  { field: "internalPartyCode", label: "Internal party code", aliases: ["internal party code", "party code", "internal code"] },
  { field: "partyKind", label: "Party kind", aliases: ["party kind", "kind", "organization or individual"] },
  { field: "eori", label: "EORI", aliases: ["eori", "eori number"] },
  { field: "duns", label: "D-U-N-S", aliases: ["duns", "d-u-n-s", "duns number"] },
  { field: "lei", label: "LEI", aliases: ["lei", "lei code"] },
  { field: "vat", label: "VAT number", aliases: ["vat", "vat number", "vat id"] },
  { field: "taxId", label: "Tax ID", aliases: ["tax id", "tin", "taxpayer id"] },
  { field: "customsId", label: "Customs ID", aliases: ["customs id", "customs identifier"] },
  { field: "customerNumber", label: "Customer number", aliases: ["customer number", "customer no", "customer id"] },
  { field: "supplierNumber", label: "Supplier number", aliases: ["supplier number", "vendor number", "supplier id"] },
  { field: "registrationNumber", label: "Registration number", aliases: ["registration number", "company registration number", "registration no"] },
  { field: "registrationCountry", label: "Registration country", aliases: ["registration country", "country of registration", "incorporation country"] },
  { field: "registeringAuthority", label: "Registering authority", aliases: ["registering authority", "registry", "registrar"] },
  { field: "legalForm", label: "Legal form", aliases: ["legal form", "entity type", "company type"] },
  { field: "addressLine1", label: "Address line 1", aliases: ["address line 1", "address", "street address", "address1"] },
  { field: "addressLine2", label: "Address line 2", aliases: ["address line 2", "address2"] },
  { field: "city", label: "City", aliases: ["city", "town"] },
  { field: "stateProvince", label: "State or province", aliases: ["state", "province", "state province", "state or province"] },
  { field: "postalCode", label: "Postal code", aliases: ["postal code", "zip", "zip code", "postcode"] },
  { field: "addressCountry", label: "Address country", aliases: ["address country", "country"] },
  { field: "contactName", label: "Contact name", aliases: ["contact name", "contact"] },
  { field: "contactEmail", label: "Contact email", aliases: ["contact email", "email"] },
  { field: "contactPhone", label: "Contact phone", aliases: ["contact phone", "phone", "telephone"] },
  { field: "roleTypes", label: "Roles", aliases: ["role", "roles", "role type", "role types"] },
];

function canonicalHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const FIELD_BY_ALIAS: ReadonlyMap<string, ImportField> = new Map(
  COLUMN_DEFINITIONS.flatMap((definition) => definition.aliases.map((alias) => [alias, definition.field] as const))
);

export interface ColumnMapping {
  /** Field to column index. A field absent from the file is absent here. */
  fields: ReadonlyMap<ImportField, number>;
  /** Headers that matched nothing. Reported, never guessed at. */
  unmappedHeaders: readonly string[];
  /** Headers claiming the same field twice, which is ambiguous. */
  duplicateHeaders: readonly string[];
}

export function mapColumns(headers: readonly string[]): ColumnMapping {
  const fields = new Map<ImportField, number>();
  const unmappedHeaders: string[] = [];
  const duplicateHeaders: string[] = [];

  headers.forEach((header, index) => {
    const canonical = canonicalHeader(header);
    if (canonical === "") return;

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

  return { fields, unmappedHeaders, duplicateHeaders };
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
  identifierType: PartyIdentifierType;
  value: string;
}

export interface ImportRegistration {
  registrationNumber: string;
  country: string;
  registeringAuthority: string | null;
  legalForm: string | null;
}

export interface ImportAddress {
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  country: string;
}

export interface ImportContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ImportPartyRow {
  legalName: string;
  tradeName: string | null;
  internalPartyCode: string | null;
  partyKind: "ORGANIZATION" | "INDIVIDUAL";
  identifiers: readonly ImportIdentifier[];
  registration: ImportRegistration | null;
  address: ImportAddress | null;
  contact: ImportContact | null;
  roleTypes: readonly PartyRoleType[];
}

export interface ImportRowResult {
  /** 1-based row number in the uploaded file, counting the header as row 1. */
  rowNumber: number;
  status: "VALID" | "INVALID";
  data: ImportPartyRow | null;
  errors: readonly ImportRowError[];
  warnings: readonly ImportRowError[];
  /**
   * A canonical rendering of the row's meaningful content. The service hashes
   * it to make a re-uploaded file a no-op instead of a duplicate.
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

const IDENTIFIER_FIELDS: readonly (readonly [ImportField, PartyIdentifierType])[] = [
  ["eori", "EORI"],
  ["duns", "DUNS"],
  ["lei", "LEI"],
  ["vat", "VAT"],
  ["taxId", "TAX_ID"],
  ["customsId", "CUSTOMS_ID"],
  ["customerNumber", "CUSTOMER_NUMBER"],
  ["supplierNumber", "SUPPLIER_NUMBER"],
];

const ROLE_TYPES: ReadonlySet<string> = new Set([
  "IMPORTER",
  "EXPORTER",
  "MANUFACTURER",
  "SUPPLIER",
  "CUSTOMER",
  "CONSIGNEE",
  "CONSIGNOR",
  "CARRIER",
  "FREIGHT_FORWARDER",
  "CUSTOMS_BROKER",
  "BUYER",
  "SELLER",
  "NOTIFY_PARTY",
  "OTHER",
]);

export function validateImport(parsed: ParsedCsv): ImportValidationResult {
  const mapping = mapColumns(parsed.headers);
  const fileErrors: ImportRowError[] = [];

  if (!mapping.fields.has("legalName")) {
    fileErrors.push({
      column: null,
      message: "The file needs a legal name column. Accepted headers: legal_name, party name, name, company name.",
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

  const rows = parsed.rows.map((row, index) => validateRow(row, index + 2, parsed.headers, mapping));

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

  const legalName = cell("legalName");
  if (legalName === null) {
    errors.push({ column: headerFor("legalName"), message: "A legal name is required." });
  }

  let partyKind: "ORGANIZATION" | "INDIVIDUAL" = "ORGANIZATION";
  const kindText = cell("partyKind");
  if (kindText !== null) {
    const upper = kindText.trim().toUpperCase();
    if (upper === "ORGANIZATION" || upper === "INDIVIDUAL") {
      partyKind = upper;
    } else {
      errors.push({
        column: headerFor("partyKind"),
        message: `"${kindText}" is not ORGANIZATION or INDIVIDUAL.`,
      });
    }
  }

  const identifiers: ImportIdentifier[] = [];
  for (const [field, identifierType] of IDENTIFIER_FIELDS) {
    const value = cell(field);
    if (value !== null) identifiers.push({ identifierType, value });
  }

  let registration: ImportRegistration | null = null;
  const registrationNumber = cell("registrationNumber");
  const registrationCountry = cell("registrationCountry");
  if (registrationNumber !== null) {
    if (registrationCountry === null) {
      errors.push({
        column: headerFor("registrationNumber"),
        message:
          "A registration number needs a registration country. The same digits mean different things in different registries, so a number on its own cannot be stored.",
      });
    } else {
      const normalized = normalizeCountry(registrationCountry);
      if (normalized.code === null) {
        warnings.push({
          column: headerFor("registrationCountry"),
          message: `"${registrationCountry}" was not recognised as a country. The value is kept as written and left unresolved rather than guessed at.`,
        });
      }
      registration = {
        registrationNumber,
        country: normalized.code ?? normalized.raw,
        registeringAuthority: cell("registeringAuthority"),
        legalForm: cell("legalForm"),
      };
    }
  } else if (registrationCountry !== null) {
    warnings.push({
      column: headerFor("registrationCountry"),
      message: "A registration country was supplied without a registration number, so no registration was created.",
    });
  }

  let address: ImportAddress | null = null;
  const addressLine1 = cell("addressLine1");
  const addressCountry = cell("addressCountry");
  if (addressLine1 !== null) {
    if (addressCountry === null) {
      errors.push({
        column: headerFor("addressLine1"),
        message: "An address needs a country.",
      });
    } else {
      const normalized = normalizeCountry(addressCountry);
      if (normalized.code === null) {
        warnings.push({
          column: headerFor("addressCountry"),
          message: `"${addressCountry}" was not recognised as a country. The value is kept as written and left unresolved rather than guessed at.`,
        });
      }
      address = {
        addressLine1,
        addressLine2: cell("addressLine2"),
        city: cell("city"),
        stateProvince: cell("stateProvince"),
        postalCode: cell("postalCode"),
        country: normalized.code ?? normalized.raw,
      };
    }
  } else if (addressCountry !== null) {
    warnings.push({
      column: headerFor("addressCountry"),
      message: "An address country was supplied without an address line, so no address was created.",
    });
  }

  const contactName = cell("contactName");
  const contactEmail = cell("contactEmail");
  const contactPhone = cell("contactPhone");
  const contact: ImportContact | null =
    contactName === null && contactEmail === null && contactPhone === null
      ? null
      : { name: contactName, email: contactEmail, phone: contactPhone };
  if (contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    errors.push({ column: headerFor("contactEmail"), message: `"${contactEmail}" is not an email address.` });
  }

  const roleTypes: PartyRoleType[] = [];
  const roleText = cell("roleTypes");
  if (roleText !== null) {
    for (const piece of roleText.split(/[;/]/)) {
      const upper = piece.trim().toUpperCase().replace(/[\s-]+/g, "_");
      if (upper === "") continue;
      if (!ROLE_TYPES.has(upper)) {
        errors.push({ column: headerFor("roleTypes"), message: `"${piece.trim()}" is not a recognised role.` });
        continue;
      }
      roleTypes.push(upper as PartyRoleType);
    }
  }

  const data: ImportPartyRow | null =
    errors.length > 0 || legalName === null
      ? null
      : {
          legalName,
          tradeName: cell("tradeName"),
          internalPartyCode: cell("internalPartyCode"),
          partyKind,
          identifiers,
          registration,
          address,
          contact,
          roleTypes,
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

/**
 * A stable rendering of a row, independent of column order.
 *
 * Used for idempotency: the same row in a re-uploaded file produces the same
 * fingerprint, so a repeated import updates nothing rather than creating a
 * second copy of every party. Blank cells are dropped so that adding an empty
 * column to a spreadsheet does not make every row look new.
 */
export function rowFingerprint(headers: readonly string[], row: readonly string[]): string {
  return headers
    .map((header, index) => [canonicalHeader(header), (row[index] ?? "").trim()] as const)
    .filter(([header, value]) => header !== "" && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([header, value]) => `${header}=${value}`)
    .join("");
}

/** The template offered on the import screen, so a user starts from a valid file. */
export const IMPORT_TEMPLATE_HEADERS: readonly string[] = [
  "legal_name",
  "trade_name",
  "internal_party_code",
  "party_kind",
  "eori",
  "vat",
  "registration_number",
  "registration_country",
  "legal_form",
  "address_line_1",
  "city",
  "postal_code",
  "address_country",
  "contact_name",
  "contact_email",
  "contact_phone",
  "roles",
];

export function importTemplateCsv(): string {
  const example = [
    "Acme Fabrication GmbH",
    "Acme",
    "SUP-1002",
    "ORGANIZATION",
    "DE123456789012345",
    "DE123456789",
    "HRB 98765",
    "DE",
    "GmbH",
    "Musterstrasse 12",
    "Munich",
    "80331",
    "DE",
    "Jonas Weber",
    "jonas.weber@acme-fab.example",
    "+49 89 1234567",
    "SUPPLIER;MANUFACTURER",
  ];
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `${IMPORT_TEMPLATE_HEADERS.join(",")}\n${example.map(quote).join(",")}\n`;
}
