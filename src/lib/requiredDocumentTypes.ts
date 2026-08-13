// The set of document types a shipment needs before it can file, and which
// of them are still missing. Required sets vary by entry type (CBP entry-type
// codes); conditional documents are driven by shipment characteristics the
// caller passes in (preferential treatment claimed, regulated product, etc.).
//
// This was previously computed independently in two places (the shipment
// detail page's missing-doc callout and ShipmentDocumentsSection's "X/N
// required document types on file" line) with matching but separately
// maintained logic. Centralizing it here keeps every surface — including
// the Command Center "My Work" view — in agreement.

export interface RequiredDocRow {
  docType: string | null;
  fileName: string | null;
  status: string;
  fileUrl?: string | null;
}

export interface DocumentTypeCheckResult {
  requiredTypes: string[];
  missingTypes: string[];
  receivedCount: number;
  totalRequired: number;
}

export interface MissingDocument {
  type: string;
  reason: string;
  blocking: boolean;
}

export interface ConditionalDocFlags {
  /** USMCA or another preference program is being claimed. */
  preferentialTreatmentClaimed: boolean;
  /** Shipment contains live plants or propagative material (HTS 06.xx). */
  livePlants: boolean;
  /** Shipment contains FDA-regulated food, beverage, or dietary supplements. */
  fdaRegulated: boolean;
  /** Shipment contains USDA FSIS-regulated meat or poultry. */
  usdaRegulated: boolean;
}

// Base required documents by CBP entry-type code.
// 01 = Formal consumption, 02 = TIB, 06 = Consumption (FTZ), 07 = Consumption
// (Antidumping), 11 = Informal (<$2,500), 23 = Informal (<$800 low-value),
// 51/52 = Transportation & Exportation, 61/62 = Immediate Transportation,
// 86 = Section 321 de minimis ($800 or less, no formal entry required).
const BASE_DOCS = ["Commercial Invoice", "Packing List", "Bill of Lading"] as const;

const ENTRY_TYPE_REQUIRED: Record<string, readonly string[]> = {
  "01": BASE_DOCS,
  "02": [...BASE_DOCS, "TIB Application"],
  "06": BASE_DOCS,
  "07": BASE_DOCS,
  "11": ["Commercial Invoice"],
  "23": ["Commercial Invoice"],
  "51": BASE_DOCS,
  "52": BASE_DOCS,
  "61": BASE_DOCS,
  "62": BASE_DOCS,
  "86": [], // Section 321 — no formal documents required
};

const DEFAULT_REQUIRED = BASE_DOCS;

// Certificate of Origin is only required when a preferential tariff treatment
// is being claimed (or origin hasn't been verified yet) — callers pass that
// in as `includeCertificateOfOrigin` rather than this module re-deriving it,
// since the HTS-based check lives alongside each caller's own origin-status
// logic.
const CONDITIONAL_DOCS: Array<{
  type: string;
  reason: string;
  blocking: boolean;
  flag: keyof ConditionalDocFlags;
}> = [
  {
    type: "Certificate of Origin",
    reason: "Required when USMCA or other preferential tariff treatment is claimed",
    blocking: true,
    flag: "preferentialTreatmentClaimed",
  },
  {
    type: "Phytosanitary Certificate",
    reason: "Required for live plants and propagative material (USDA APHIS)",
    blocking: true,
    flag: "livePlants",
  },
  {
    type: "FDA Prior Notice",
    reason: "Required for FDA-regulated food, beverage, or dietary supplement imports",
    blocking: true,
    flag: "fdaRegulated",
  },
  {
    type: "USDA FSIS Import Permit",
    reason: "Required for meat and poultry products (USDA FSIS)",
    blocking: true,
    flag: "usdaRegulated",
  },
];

const isDocReceived = (d: RequiredDocRow) =>
  d.status !== "Missing" &&
  Boolean(
    d.fileUrl ||
      d.status === "Received" ||
      d.status === "Processed" ||
      d.status === "Review Required" ||
      d.status === "Completed" ||
      d.status === "READY" ||
      d.status === "NEEDS_REVIEW"
  );

function docMatchesType(d: RequiredDocRow, requiredType: string): boolean {
  if (!isDocReceived(d)) return false;
  const type = (d.docType || "").toLowerCase();
  const name = (d.fileName || "").toLowerCase();
  const rt = requiredType.toLowerCase();

  if (rt.includes("invoice")) return type.includes("invoice") || name.includes("invoice");
  if (rt.includes("packing")) return type.includes("packing") || name.includes("packing");
  if (rt.includes("lading"))
    return (
      type.includes("lading") ||
      type.includes("transport") ||
      name.includes("lading") ||
      name.includes("instructions") ||
      name.includes("waybill")
    );
  if (rt.includes("certificate of origin") || rt.includes("coo"))
    return type.includes("origin") || type.includes("coo") || name.includes("origin") || name.includes("coo");
  if (rt.includes("tib"))
    return type.includes("tib") || type.includes("temporary import") || name.includes("tib");
  if (rt.includes("phytosanitary"))
    return type.includes("phytosanitary") || name.includes("phytosanitary");
  if (rt.includes("fda prior notice"))
    return type.includes("fda") || type.includes("prior notice") || name.includes("prior notice");
  if (rt.includes("fsis") || rt.includes("usda"))
    return type.includes("fsis") || type.includes("usda") || name.includes("fsis");
  // Generic substring fallback
  return type.includes(rt) || name.includes(rt);
}

/**
 * Returns which required document types are present and which are missing.
 *
 * @param documents - Documents attached to the shipment.
 * @param includeCertificateOfOrigin - Maintained for backwards compatibility;
 *   pass `conditionalFlags.preferentialTreatmentClaimed` to the new overload.
 * @param entryType - Optional CBP entry-type code (e.g. "01", "86"). Defaults
 *   to the base set when absent or unrecognised.
 * @param conditionalFlags - Which conditional documents to include.
 */
export function checkRequiredDocumentTypes(
  documents: RequiredDocRow[],
  includeCertificateOfOrigin: boolean,
  entryType?: string | null,
  conditionalFlags?: Partial<ConditionalDocFlags>
): DocumentTypeCheckResult {
  const baseTypes =
    entryType && ENTRY_TYPE_REQUIRED[entryType]
      ? [...ENTRY_TYPE_REQUIRED[entryType]]
      : [...DEFAULT_REQUIRED];

  if (includeCertificateOfOrigin && !baseTypes.includes("Certificate of Origin")) {
    baseTypes.push("Certificate of Origin");
  }

  const flags = conditionalFlags ?? {};
  for (const cond of CONDITIONAL_DOCS) {
    if (cond.flag === "preferentialTreatmentClaimed") continue; // handled via includeCertificateOfOrigin
    if (flags[cond.flag] && !baseTypes.includes(cond.type)) {
      baseTypes.push(cond.type);
    }
  }

  const requiredTypes = baseTypes;
  const missingTypes = requiredTypes.filter(
    (req) => !documents.some((d) => docMatchesType(d, req))
  );

  return {
    requiredTypes,
    missingTypes,
    receivedCount: requiredTypes.length - missingTypes.length,
    totalRequired: requiredTypes.length,
  };
}

/**
 * Returns the full missing-document list including conditional docs, with
 * reason strings and blocking flags — used by D-2 (GET /api/shipments/[id]).
 */
export function getMissingDocuments(
  documents: RequiredDocRow[],
  entryType: string | null | undefined,
  conditionalFlags: Partial<ConditionalDocFlags>
): MissingDocument[] {
  const baseTypes =
    entryType && ENTRY_TYPE_REQUIRED[entryType]
      ? [...ENTRY_TYPE_REQUIRED[entryType]]
      : [...DEFAULT_REQUIRED];

  const missing: MissingDocument[] = [];

  for (const type of baseTypes) {
    if (!documents.some((d) => docMatchesType(d, type))) {
      missing.push({
        type,
        reason: `Required for ${entryType ? `entry type ${entryType}` : "customs filing"}`,
        blocking: true,
      });
    }
  }

  for (const cond of CONDITIONAL_DOCS) {
    if (!conditionalFlags[cond.flag]) continue;
    if (baseTypes.includes(cond.type)) continue; // already covered above
    if (!documents.some((d) => docMatchesType(d, cond.type))) {
      missing.push({ type: cond.type, reason: cond.reason, blocking: cond.blocking });
    }
  }

  return missing;
}
