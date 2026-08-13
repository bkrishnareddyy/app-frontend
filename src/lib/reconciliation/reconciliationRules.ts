/**
 * Cross-document reconciliation rule table.
 *
 * Pure data — no functions. The engine in reconciliationEngine.ts reads this
 * table and decides how to apply each rule. Adding a new check is a new row
 * here, not a code change.
 *
 * fieldKey matches ExtractionField.fieldName values stored by the extraction
 * pipeline. docTypeA / docTypeB are substring-matched against
 * ShipmentDocument.docType so "Commercial Invoice" matches both
 * "Commercial Invoice" and "Commercial Invoice / Pro-Forma Invoice".
 */

export type DiscrepancyType =
  | "QUANTITY"
  | "VALUE"
  | "WEIGHT"
  | "PARTY"
  | "ORIGIN"
  | "CONTAINER"
  | "DATE"
  | "REFERENCE"
  | "CURRENCY";

export type NormalizationFn =
  | "text"          // case-insensitive, collapse whitespace
  | "number"        // strip non-numeric chars, parse float
  | "currency_amount" // strip currency symbols + commas, parse float
  | "party_name"    // normalize punctuation & legal suffixes (Ltd → Limited, etc.)
  | "container_id"; // uppercase, strip spaces and dashes

export interface ReconciliationRule {
  id: string;
  /** Matches ExtractionField.fieldName. */
  fieldKey: string;
  /** Substring-matched against docType of the "reference" document. */
  docTypeA: string;
  /** Substring-matched against docType of the "compared" document. */
  docTypeB: string;
  discrepancyType: DiscrepancyType;
  normalizationFn: NormalizationFn;
  /**
   * Allowed percentage difference before a mismatch is raised.
   * 0 = exact match. Only meaningful for numeric normalization functions.
   */
  tolerancePct: number;
  /** True → issue severity is BLOCKING; false → WARNING. */
  blocksFiling: boolean;
  description: string;
}

export const RECONCILIATION_RULES: readonly ReconciliationRule[] = [
  // ── Quantity ────────────────────────────────────────────────────────────────
  {
    id: "QTY_INV_PACK",
    fieldKey: "totalQuantity",
    docTypeA: "Invoice",
    docTypeB: "Packing",
    discrepancyType: "QUANTITY",
    normalizationFn: "number",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Invoice quantity vs. packing list quantity",
  },
  {
    id: "QTY_INV_BL",
    fieldKey: "totalQuantity",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "QUANTITY",
    normalizationFn: "number",
    tolerancePct: 5,
    blocksFiling: false,
    description: "Invoice quantity vs. bill of lading quantity",
  },

  // ── Value ────────────────────────────────────────────────────────────────────
  {
    id: "VAL_INV_PACK",
    fieldKey: "totalValue",
    docTypeA: "Invoice",
    docTypeB: "Packing",
    discrepancyType: "VALUE",
    normalizationFn: "currency_amount",
    tolerancePct: 2,
    blocksFiling: true,
    description: "Invoice total value vs. packing list declared value",
  },
  {
    id: "VAL_INV_BL",
    fieldKey: "totalValue",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "VALUE",
    normalizationFn: "currency_amount",
    tolerancePct: 2,
    blocksFiling: false,
    description: "Invoice total value vs. bill of lading declared value",
  },

  // ── Currency ─────────────────────────────────────────────────────────────────
  {
    id: "CURR_INV_PACK",
    fieldKey: "currency",
    docTypeA: "Invoice",
    docTypeB: "Packing",
    discrepancyType: "CURRENCY",
    normalizationFn: "text",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Invoice currency vs. packing list currency",
  },
  {
    id: "CURR_INV_BL",
    fieldKey: "currency",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "CURRENCY",
    normalizationFn: "text",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Invoice currency vs. bill of lading currency",
  },

  // ── Weight ───────────────────────────────────────────────────────────────────
  {
    id: "WEIGHT_INV_PACK",
    fieldKey: "grossWeight",
    docTypeA: "Invoice",
    docTypeB: "Packing",
    discrepancyType: "WEIGHT",
    normalizationFn: "number",
    tolerancePct: 5,
    blocksFiling: false,
    description: "Invoice gross weight vs. packing list gross weight",
  },
  {
    id: "WEIGHT_PACK_BL",
    fieldKey: "grossWeight",
    docTypeA: "Packing",
    docTypeB: "Lading",
    discrepancyType: "WEIGHT",
    normalizationFn: "number",
    tolerancePct: 5,
    blocksFiling: false,
    description: "Packing list gross weight vs. bill of lading gross weight",
  },
  {
    id: "NET_WEIGHT_INV_PACK",
    fieldKey: "netWeight",
    docTypeA: "Invoice",
    docTypeB: "Packing",
    discrepancyType: "WEIGHT",
    normalizationFn: "number",
    tolerancePct: 3,
    blocksFiling: false,
    description: "Invoice net weight vs. packing list net weight",
  },

  // ── Parties ──────────────────────────────────────────────────────────────────
  {
    id: "SHIPPER_INV_BL",
    fieldKey: "shipperName",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "PARTY",
    normalizationFn: "party_name",
    tolerancePct: 0,
    blocksFiling: false,
    description: "Invoice seller/exporter vs. bill of lading shipper",
  },
  {
    id: "CONSIGNEE_INV_BL",
    fieldKey: "consigneeName",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "PARTY",
    normalizationFn: "party_name",
    tolerancePct: 0,
    blocksFiling: false,
    description: "Invoice buyer/consignee vs. bill of lading consignee",
  },
  {
    id: "NOTIFY_INV_BL",
    fieldKey: "notifyParty",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "PARTY",
    normalizationFn: "party_name",
    tolerancePct: 0,
    blocksFiling: false,
    description: "Invoice notify party vs. bill of lading notify party",
  },
  {
    id: "SHIPPER_PACK_BL",
    fieldKey: "shipperName",
    docTypeA: "Packing",
    docTypeB: "Lading",
    discrepancyType: "PARTY",
    normalizationFn: "party_name",
    tolerancePct: 0,
    blocksFiling: false,
    description: "Packing list shipper vs. bill of lading shipper",
  },

  // ── Container ────────────────────────────────────────────────────────────────
  {
    id: "CONTAINER_BL_PACK",
    fieldKey: "containerNumber",
    docTypeA: "Lading",
    docTypeB: "Packing",
    discrepancyType: "CONTAINER",
    normalizationFn: "container_id",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Bill of lading container number vs. packing list container number",
  },
  {
    id: "CONTAINER_BL_INV",
    fieldKey: "containerNumber",
    docTypeA: "Lading",
    docTypeB: "Invoice",
    discrepancyType: "CONTAINER",
    normalizationFn: "container_id",
    tolerancePct: 0,
    blocksFiling: false,
    description: "Bill of lading container number vs. invoice container reference",
  },

  // ── Origin ───────────────────────────────────────────────────────────────────
  {
    id: "ORIGIN_COO_INV",
    fieldKey: "countryOfOrigin",
    docTypeA: "Certificate of Origin",
    docTypeB: "Invoice",
    discrepancyType: "ORIGIN",
    normalizationFn: "text",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Certificate of origin country vs. invoice declared country of origin",
  },
  {
    id: "ORIGIN_COO_PACK",
    fieldKey: "countryOfOrigin",
    docTypeA: "Certificate of Origin",
    docTypeB: "Packing",
    discrepancyType: "ORIGIN",
    normalizationFn: "text",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Certificate of origin country vs. packing list country of origin",
  },

  // ── Reference numbers ────────────────────────────────────────────────────────
  {
    id: "BL_NUM_INV_BL",
    fieldKey: "billOfLadingNumber",
    docTypeA: "Invoice",
    docTypeB: "Lading",
    discrepancyType: "REFERENCE",
    normalizationFn: "text",
    tolerancePct: 0,
    blocksFiling: true,
    description: "Invoice B/L reference vs. bill of lading number",
  },
  {
    id: "INV_NUM_CROSS",
    fieldKey: "invoiceNumber",
    docTypeA: "Invoice",
    docTypeB: "Packing",
    discrepancyType: "REFERENCE",
    normalizationFn: "text",
    tolerancePct: 0,
    blocksFiling: false,
    description: "Invoice number vs. packing list invoice reference",
  },
];
