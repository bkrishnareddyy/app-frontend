/**
 * Per-document-type extraction field schemas (C-2).
 *
 * Each entry names a field that the extraction pipeline must attempt to locate
 * in the document. `required: true` means the field's absence creates a
 * MISSING_DATA ExceptionItem (C-5). `type` drives downstream validation and
 * display formatting.
 */
import type { DocumentType } from "@prisma/client";

export type ExtractionFieldType = "string" | "number" | "date" | "array";

export interface ExtractionFieldSchema {
  fieldName: string;
  label: string;
  required: boolean;
  type: ExtractionFieldType;
}

export type ExtractionSchema = ExtractionFieldSchema[];

const COMMERCIAL_INVOICE_SCHEMA: ExtractionSchema = [
  { fieldName: "seller_name",     label: "Seller / Exporter",    required: true,  type: "string" },
  { fieldName: "buyer_name",      label: "Buyer / Consignee",    required: true,  type: "string" },
  { fieldName: "invoice_number",  label: "Invoice Number",        required: true,  type: "string" },
  { fieldName: "invoice_date",    label: "Invoice Date",          required: true,  type: "date"   },
  { fieldName: "currency",        label: "Currency",              required: true,  type: "string" },
  { fieldName: "total_value",     label: "Total Invoice Value",   required: true,  type: "number" },
  { fieldName: "incoterm",        label: "Incoterm",              required: false, type: "string" },
  { fieldName: "line_items",      label: "Line Items",            required: true,  type: "array"  },
];

const PACKING_LIST_SCHEMA: ExtractionSchema = [
  { fieldName: "carton_count",    label: "Carton Count",          required: true,  type: "number" },
  { fieldName: "gross_weight",    label: "Gross Weight",          required: true,  type: "number" },
  { fieldName: "net_weight",      label: "Net Weight",            required: false, type: "number" },
  { fieldName: "package_marks",   label: "Package Marks",         required: false, type: "string" },
];

const BILL_OF_LADING_SCHEMA: ExtractionSchema = [
  { fieldName: "bl_number",          label: "B/L Number",               required: true,  type: "string" },
  { fieldName: "vessel_name",        label: "Vessel Name",               required: true,  type: "string" },
  { fieldName: "voyage",             label: "Voyage Number",             required: false, type: "string" },
  { fieldName: "port_of_loading",    label: "Port of Loading",           required: true,  type: "string" },
  { fieldName: "port_of_discharge",  label: "Port of Discharge",         required: true,  type: "string" },
  { fieldName: "container_numbers",  label: "Container Numbers",         required: false, type: "array"  },
  { fieldName: "on_board_date",      label: "On-Board Date",             required: true,  type: "date"   },
];

const AIR_WAYBILL_SCHEMA: ExtractionSchema = [
  { fieldName: "awb_number",         label: "AWB Number",                required: true,  type: "string" },
  { fieldName: "shipper_name",       label: "Shipper",                   required: true,  type: "string" },
  { fieldName: "consignee_name",     label: "Consignee",                 required: true,  type: "string" },
  { fieldName: "airport_of_origin",  label: "Airport of Departure",      required: true,  type: "string" },
  { fieldName: "airport_of_dest",    label: "Airport of Destination",    required: true,  type: "string" },
  { fieldName: "gross_weight",       label: "Gross Weight",              required: true,  type: "number" },
];

const CERTIFICATE_OF_ORIGIN_SCHEMA: ExtractionSchema = [
  { fieldName: "exporter_name",      label: "Exporter",                  required: true,  type: "string" },
  { fieldName: "consignee_name",     label: "Consignee",                 required: true,  type: "string" },
  { fieldName: "country_of_origin",  label: "Country of Origin",         required: true,  type: "string" },
  { fieldName: "goods_description",  label: "Description of Goods",      required: true,  type: "string" },
  { fieldName: "hs_code",            label: "HS Code",                   required: false, type: "string" },
];

const PHYTOSANITARY_SCHEMA: ExtractionSchema = [
  { fieldName: "issuing_authority",  label: "Issuing Authority",         required: true,  type: "string" },
  { fieldName: "exporter_name",      label: "Exporter",                  required: true,  type: "string" },
  { fieldName: "goods_description",  label: "Description of Goods",      required: true,  type: "string" },
  { fieldName: "issue_date",         label: "Issue Date",                required: true,  type: "date"   },
];

const FUMIGATION_SCHEMA: ExtractionSchema = [
  { fieldName: "treatment_method",   label: "Treatment Method",          required: true,  type: "string" },
  { fieldName: "chemical_used",      label: "Chemical / Fumigant",       required: true,  type: "string" },
  { fieldName: "treatment_date",     label: "Treatment Date",            required: true,  type: "date"   },
  { fieldName: "goods_description",  label: "Description of Goods",      required: true,  type: "string" },
];

const CUSTOMS_BOND_SCHEMA: ExtractionSchema = [
  { fieldName: "bond_number",        label: "Bond Number",               required: true,  type: "string" },
  { fieldName: "surety_name",        label: "Surety Company",            required: true,  type: "string" },
  { fieldName: "bond_amount",        label: "Bond Amount",               required: true,  type: "number" },
  { fieldName: "effective_date",     label: "Effective Date",            required: true,  type: "date"   },
];

const POWER_OF_ATTORNEY_SCHEMA: ExtractionSchema = [
  { fieldName: "grantor_name",       label: "Grantor",                   required: true,  type: "string" },
  { fieldName: "grantee_name",       label: "Grantee (Broker)",          required: true,  type: "string" },
  { fieldName: "effective_date",     label: "Effective Date",            required: false, type: "date"   },
];

const ENTRY_SUMMARY_SCHEMA: ExtractionSchema = [
  { fieldName: "entry_number",       label: "Entry Number",              required: true,  type: "string" },
  { fieldName: "entry_date",         label: "Entry Date",                required: true,  type: "date"   },
  { fieldName: "importer_name",      label: "Importer of Record",        required: true,  type: "string" },
  { fieldName: "port_of_entry",      label: "Port of Entry",             required: true,  type: "string" },
  { fieldName: "total_duties",       label: "Total Duties & Taxes",      required: true,  type: "number" },
];

const ISF_SCHEMA: ExtractionSchema = [
  { fieldName: "importer_of_record", label: "Importer of Record",        required: true,  type: "string" },
  { fieldName: "seller_name",        label: "Seller",                    required: true,  type: "string" },
  { fieldName: "buyer_name",         label: "Buyer",                     required: true,  type: "string" },
  { fieldName: "manufacturer_name",  label: "Manufacturer",              required: true,  type: "string" },
  { fieldName: "ship_to_party",      label: "Ship-to Party",             required: true,  type: "string" },
  { fieldName: "country_of_origin",  label: "Country of Origin",         required: true,  type: "string" },
  { fieldName: "hs_6_code",          label: "HS-6 Code",                 required: true,  type: "string" },
  { fieldName: "container_stuffing", label: "Container Stuffing Location", required: true, type: "string" },
  { fieldName: "consolidator_name",  label: "Consolidator",              required: false, type: "string" },
];

const SCHEMAS: Partial<Record<DocumentType, ExtractionSchema>> = {
  COMMERCIAL_INVOICE:       COMMERCIAL_INVOICE_SCHEMA,
  PACKING_LIST:             PACKING_LIST_SCHEMA,
  BILL_OF_LADING:           BILL_OF_LADING_SCHEMA,
  AIR_WAYBILL:              AIR_WAYBILL_SCHEMA,
  CERTIFICATE_OF_ORIGIN:    CERTIFICATE_OF_ORIGIN_SCHEMA,
  PHYTOSANITARY_CERTIFICATE: PHYTOSANITARY_SCHEMA,
  FUMIGATION_CERTIFICATE:   FUMIGATION_SCHEMA,
  CUSTOMS_BOND:             CUSTOMS_BOND_SCHEMA,
  POWER_OF_ATTORNEY:        POWER_OF_ATTORNEY_SCHEMA,
  ENTRY_SUMMARY:            ENTRY_SUMMARY_SCHEMA,
  ISF:                      ISF_SCHEMA,
  // OTHER has no required fields — extraction is opportunistic.
};

/**
 * Returns the extraction schema for a given document type.
 * Returns an empty array for OTHER or unknown types.
 */
export function getExtractionSchema(docType: DocumentType | null | undefined): ExtractionSchema {
  if (!docType) return [];
  return SCHEMAS[docType] ?? [];
}

/**
 * Returns only the fields marked `required: true` for a document type.
 */
export function getRequiredFields(docType: DocumentType | null | undefined): ExtractionFieldSchema[] {
  return getExtractionSchema(docType).filter((f) => f.required);
}
