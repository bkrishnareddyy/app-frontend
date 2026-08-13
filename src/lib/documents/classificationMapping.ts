/**
 * Maps free-text document type strings (as returned by the AI classifier) to
 * the canonical DocumentType Prisma enum. The AI prompt never guarantees a
 * controlled vocabulary, so the lookup is keyword-based and case-insensitive.
 *
 * Unknown types resolve to "OTHER". The caller decides what to do when the
 * mapping confidence is below CLASSIFICATION_CONFIDENCE_THRESHOLD.
 */
import type { DocumentType } from "@prisma/client";

/** Confidence below this (0–1 scale) routes the document to human review. */
export const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.7;

type Matcher = { keywords: string[]; type: DocumentType };

const MATCHERS: Matcher[] = [
  { keywords: ["commercial invoice", "invoice"], type: "COMMERCIAL_INVOICE" },
  { keywords: ["packing list", "packing slip", "weight list"], type: "PACKING_LIST" },
  { keywords: ["bill of lading", "bl", "ocean bill", "master bill", "house bill"], type: "BILL_OF_LADING" },
  { keywords: ["air waybill", "airway bill", "awb", "mawb", "hawb"], type: "AIR_WAYBILL" },
  { keywords: ["certificate of origin", "co", "coo", "usmca", "nafta", "form a", "gsp certificate"], type: "CERTIFICATE_OF_ORIGIN" },
  { keywords: ["phytosanitary", "plant health", "plant certificate"], type: "PHYTOSANITARY_CERTIFICATE" },
  { keywords: ["fumigation", "treatment certificate", "heat treatment"], type: "FUMIGATION_CERTIFICATE" },
  { keywords: ["customs bond", "surety bond", "import bond"], type: "CUSTOMS_BOND" },
  { keywords: ["power of attorney", "poa"], type: "POWER_OF_ATTORNEY" },
  { keywords: ["entry summary", "cbp form 7501", "7501", "entry type"], type: "ENTRY_SUMMARY" },
  { keywords: ["importer security filing", "isf", "10+2", "10 2"], type: "ISF" },
];

/**
 * Maps a raw classifier string to a DocumentType enum value.
 * Returns "OTHER" when no matcher fires.
 */
export function mapToDocumentType(raw: string): DocumentType {
  const lower = raw.toLowerCase().trim();
  for (const { keywords, type } of MATCHERS) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return "OTHER";
}

/**
 * Normalises a classifier confidence value to the 0–1 scale this module
 * uses. The AI returns 0–100; everything else is clamped.
 */
export function normaliseConfidence(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  if (raw > 1) return Math.min(raw / 100, 1);
  return Math.min(Math.max(raw, 0), 1);
}
