/**
 * Resolution reason picklist — v1.
 *
 * In 8 months this picklist is your CF-28 answer and your audit analytics.
 * Every reason has a stable code (never changes once published), a human
 * label, and the exception categories it is valid for.
 *
 * Adding a new code is non-breaking; removing one requires a migration that
 * replaces existing stored codes.
 */

export type ExceptionCategory =
  | "MISSING_DATA"
  | "CONFLICT"
  | "VALIDATION"
  | "COMPLIANCE"
  | "DOCUMENT"
  | "CLASSIFICATION"
  | "VALUATION"
  | "FILING";

export interface ResolutionReason {
  /** Stable code stored to ExceptionItem.resolutionReasonCode. Never rename. */
  code: string;
  /** Human-readable label shown in the picklist. */
  label: string;
  /** Categories this reason is valid for. Empty = valid for all categories. */
  categories: ExceptionCategory[];
  /** When true, the reason is a risk acceptance (same semantics as WAIVED). */
  isRiskAcceptance?: boolean;
}

export const RESOLUTION_REASONS: readonly ResolutionReason[] = [
  // ─── Document ────────────────────────────────────────────────────────────
  {
    code: "DOC_UPLOADED",
    label: "Document uploaded",
    categories: ["DOCUMENT", "MISSING_DATA"],
  },
  {
    code: "DOC_NOT_REQUIRED",
    label: "Document confirmed not required for this entry type",
    categories: ["DOCUMENT"],
  },
  {
    code: "DOC_OBTAINED_ALTERNATIVE",
    label: "Alternative documentation obtained",
    categories: ["DOCUMENT"],
  },

  // ─── Missing / conflicting data ──────────────────────────────────────────
  {
    code: "DATA_VERIFIED_SOURCE",
    label: "Value verified against source document",
    categories: ["MISSING_DATA", "CONFLICT", "VALIDATION"],
  },
  {
    code: "DATA_CORRECTED",
    label: "Data corrected in the entry",
    categories: ["MISSING_DATA", "CONFLICT", "VALIDATION"],
  },
  {
    code: "DATA_CONFIRMED_IMPORTER",
    label: "Confirmed with importer",
    categories: ["MISSING_DATA", "CONFLICT"],
  },

  // ─── Classification ───────────────────────────────────────────────────────
  {
    code: "CLASS_CONFIRMED_RULING",
    label: "Classification confirmed via CBP ruling",
    categories: ["CLASSIFICATION"],
  },
  {
    code: "CLASS_CONFIRMED_BROKER",
    label: "Classification reviewed and confirmed by licensed broker",
    categories: ["CLASSIFICATION"],
  },
  {
    code: "CLASS_CORRECTED",
    label: "HTS code corrected",
    categories: ["CLASSIFICATION"],
  },

  // ─── Valuation ────────────────────────────────────────────────────────────
  {
    code: "VAL_CONFIRMED",
    label: "Customs value confirmed against invoice",
    categories: ["VALUATION"],
  },
  {
    code: "VAL_ADJUSTED",
    label: "Customs value adjusted and documented",
    categories: ["VALUATION"],
  },

  // ─── Compliance / Filing ─────────────────────────────────────────────────
  {
    code: "COMPLIANCE_CLEARED",
    label: "Compliance check passed on re-evaluation",
    categories: ["COMPLIANCE", "FILING"],
  },
  {
    code: "COMPLIANCE_WAIVER_OBTAINED",
    label: "Regulatory waiver or exemption obtained",
    categories: ["COMPLIANCE"],
  },

  // ─── Risk acceptance (waive) ─────────────────────────────────────────────
  {
    code: "RISK_ACCEPTED_BROKER",
    label: "Risk accepted — broker determination on file",
    categories: [],
    isRiskAcceptance: true,
  },
  {
    code: "RISK_ACCEPTED_IMPORTER",
    label: "Risk accepted — importer instruction on file",
    categories: [],
    isRiskAcceptance: true,
  },

  // ─── Other ────────────────────────────────────────────────────────────────
  {
    code: "FALSE_POSITIVE",
    label: "False positive — exception does not apply",
    categories: [],
  },
  {
    code: "OTHER",
    label: "Other — see note",
    categories: [],
  },
] as const;

const BY_CODE = new Map(RESOLUTION_REASONS.map((r) => [r.code, r]));

export function getResolutionReason(code: string): ResolutionReason | null {
  return BY_CODE.get(code) ?? null;
}

/**
 * Returns reasons valid for a given exception category.
 * An empty `categories` array on a reason means it applies universally.
 */
export function reasonsForCategory(category: ExceptionCategory | null): readonly ResolutionReason[] {
  if (!category) return RESOLUTION_REASONS;
  return RESOLUTION_REASONS.filter(
    (r) => r.categories.length === 0 || r.categories.includes(category)
  );
}

/**
 * Validates that a reason code is known and applicable to the given category.
 * Returns null when valid, or an error string when not.
 */
export function validateReasonCode(
  code: string,
  category: ExceptionCategory | null
): string | null {
  const reason = getResolutionReason(code);
  if (!reason) return `Unknown resolution reason code: "${code}"`;
  if (
    category &&
    reason.categories.length > 0 &&
    !reason.categories.includes(category)
  ) {
    return `Reason "${code}" is not valid for exception category "${category}"`;
  }
  return null;
}

export function isRiskAcceptanceReason(code: string): boolean {
  return getResolutionReason(code)?.isRiskAcceptance === true;
}
