/**
 * How product state is worded and coloured on screen.
 *
 * Kept pure and separate from the pages so the wording can be asserted in a
 * test. The wording matters more than usual here: a CANDIDATE classification and
 * an APPROVED one look alike in a table unless the labels insist otherwise, and
 * a product's tariff code being "8481.80.5090" is meaningless without the
 * jurisdiction it was approved for.
 */

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  /** One sentence a reviewer can read. Empty string where none is needed. */
  hint: string;
}

const PRODUCT_STATUS: Record<string, StatusPresentation> = {
  DRAFT: { label: "Draft", tone: "neutral", hint: "Not yet in use." },
  ACTIVE: { label: "Active", tone: "success", hint: "" },
  INACTIVE: { label: "Inactive", tone: "neutral", hint: "Kept for history, not for new shipments." },
  SUPERSEDED: { label: "Superseded", tone: "neutral", hint: "Replaced by another product." },
  ARCHIVED: { label: "Archived", tone: "neutral", hint: "" },
};

export function productStatusPresentation(status: string): StatusPresentation {
  return PRODUCT_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

const REVIEW_STATUS: Record<string, StatusPresentation> = {
  UNREVIEWED: {
    label: "Unreviewed",
    tone: "neutral",
    hint: "Nobody in this account has checked this product's master data.",
  },
  IN_REVIEW: { label: "In review", tone: "info", hint: "" },
  APPROVED: {
    label: "Reviewed",
    tone: "success",
    hint: "The master data has been reviewed. This says nothing about its classifications.",
  },
  REJECTED: { label: "Rejected", tone: "danger", hint: "" },
  NEEDS_REVIEW: {
    label: "Needs review",
    tone: "warning",
    hint: "Something customs-significant changed since this was last looked at.",
  },
};

export function reviewStatusPresentation(status: string): StatusPresentation {
  return REVIEW_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

/**
 * Classification status.
 *
 * Only APPROVED is a position of record. Everything else is worded so that it
 * cannot be mistaken for one — "Candidate", not "Suggested code"; "Proposed",
 * not "Pending approval" — and the hint says outright what the row is not.
 */
const CLASSIFICATION_STATUS: Record<string, StatusPresentation> = {
  CANDIDATE: {
    label: "Candidate",
    tone: "neutral",
    hint: "Working state. Not a customs position and not usable on a filing.",
  },
  PROPOSED: {
    label: "Proposed",
    tone: "info",
    hint: "Someone has put this forward. It has not been approved.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "info",
    hint: "Being reviewed now. Not yet approved.",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    hint: "The approved classification for this jurisdiction.",
  },
  REJECTED: { label: "Rejected", tone: "danger", hint: "Considered and turned down." },
  SUPERSEDED: {
    label: "Superseded",
    tone: "neutral",
    hint: "Replaced by a later approved classification. Kept for history.",
  },
  EXPIRED: { label: "Expired", tone: "warning", hint: "Past its effective period." },
};

export function classificationStatusPresentation(status: string): StatusPresentation {
  return CLASSIFICATION_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

const COUNTRY_FACT_STATUS: Record<string, StatusPresentation> = {
  CLAIMED: {
    label: "Claimed",
    tone: "neutral",
    hint: "As stated by the source. Nobody has checked it against evidence.",
  },
  UNDER_REVIEW: { label: "Under review", tone: "info", hint: "" },
  VERIFIED: {
    label: "Verified",
    tone: "success",
    hint: "Checked against the attached evidence by a named reviewer.",
  },
  REJECTED: { label: "Rejected", tone: "danger", hint: "" },
  SUPERSEDED: { label: "Superseded", tone: "neutral", hint: "" },
};

export function countryFactStatusPresentation(status: string): StatusPresentation {
  return COUNTRY_FACT_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

/**
 * Country fact types.
 *
 * The descriptions are the whole reason this table exists: country of
 * manufacture is a fact about where goods were made, country of origin is a
 * legal conclusion drawn from rules that Qubere does not apply, and the screen
 * has to say so wherever the two appear together.
 */
const COUNTRY_FACT_TYPE: Record<string, { label: string; description: string }> = {
  MANUFACTURE_COUNTRY: {
    label: "Country of manufacture",
    description: "Where the goods were made. Not, on its own, the country of origin.",
  },
  PRODUCTION_COUNTRY: {
    label: "Country of production",
    description: "Where production took place. Not, on its own, the country of origin.",
  },
  ORIGIN_CLAIM: {
    label: "Claimed country of origin",
    description:
      "An origin someone has claimed. Qubere records the claim and its evidence; it does not apply rules of origin.",
  },
};

export function countryFactTypePresentation(factType: string): { label: string; description: string } {
  return COUNTRY_FACT_TYPE[factType] ?? { label: factType, description: "" };
}

const SIGNIFICANCE: Record<string, StatusPresentation> = {
  NON_MATERIAL: { label: "Non-material", tone: "neutral", hint: "" },
  POTENTIALLY_CUSTOMS_SIGNIFICANT: {
    label: "Possibly customs-significant",
    tone: "warning",
    hint: "",
  },
  CUSTOMS_SIGNIFICANT: { label: "Customs-significant", tone: "danger", hint: "" },
};

export function significancePresentation(significance: string): StatusPresentation {
  return SIGNIFICANCE[significance] ?? { label: significance, tone: "neutral", hint: "" };
}

/**
 * What a revalidation flag is asking for.
 *
 * Every one of these is a request for a person to look again. None of them
 * changes a classification, an origin or a value, and the wording avoids any
 * verb that would suggest otherwise.
 */
const REVALIDATION: Record<string, { label: string; description: string }> = {
  CLASSIFICATION_REVALIDATION_REQUIRED: {
    label: "Re-check classification",
    description:
      "A fact this product's classification rests on has changed. The approved classification still stands until someone reviews it.",
  },
  ORIGIN_REVALIDATION_REQUIRED: {
    label: "Re-check origin",
    description:
      "A fact bearing on origin has changed. Nothing here concludes what the origin now is.",
  },
  REGULATORY_REVALIDATION_REQUIRED: {
    label: "Re-check regulatory position",
    description: "A fact bearing on regulatory treatment has changed.",
  },
  VALUATION_REVIEW_REQUIRED: {
    label: "Review valuation",
    description: "A fact bearing on how this product is valued has changed.",
  },
};

export function revalidationPresentation(flag: string): { label: string; description: string } {
  return REVALIDATION[flag] ?? { label: flag, description: "" };
}

/**
 * A revalidation flag's `reason` is one or more `Entity.field: explanation`
 * fragments concatenated by revalidationSignals() in productChangeDetection.ts.
 * The `Entity.field` part is a technical identifier -- the History tab already
 * renders it in monospace rather than as prose -- so it is split out here
 * instead of being read as the start of a sentence.
 */
export interface ChangeReasonSegment {
  source: string;
  text: string;
}

const CHANGE_REASON_SEGMENT = /([A-Za-z]+(?::[A-Za-z0-9_]+)?\.[A-Za-z]+):\s*/g;

export function parseChangeReason(reason: string): ChangeReasonSegment[] {
  const matches = [...reason.matchAll(CHANGE_REASON_SEGMENT)];
  if (matches.length === 0) return [{ source: "", text: reason }];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? reason.length : reason.length;
    return { source: match[1], text: reason.slice(start, end).trim() };
  });
}

const SOURCE_TYPE: Record<string, string> = {
  DOCUMENT: "Document",
  EXTRACTED_FACT: "Extracted from a document",
  ERP: "ERP",
  PIM: "PIM",
  USER: "Entered by a user",
  MANUFACTURER_DATASHEET: "Manufacturer datasheet",
  SUPPLIER_DECLARATION: "Supplier declaration",
  CUSTOMS_RULING: "Customs ruling",
  REGULATORY_SOURCE: "Regulatory source",
  IMPORT: "Bulk import",
  AGENT: "Proposed by an agent",
  OTHER: "Other",
};

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE[sourceType] ?? sourceType;
}

const IDENTIFIER_TYPE: Record<string, string> = {
  INTERNAL_SKU: "Internal SKU",
  CUSTOMER_SKU: "Customer SKU",
  SUPPLIER_SKU: "Supplier SKU",
  MANUFACTURER_PART_NUMBER: "Manufacturer part number",
  MODEL_NUMBER: "Model number",
  GTIN: "GTIN",
  UPC: "UPC",
  EAN: "EAN",
  STYLE_NUMBER: "Style number",
  OTHER: "Other",
};

export function identifierTypeLabel(identifierType: string): string {
  return IDENTIFIER_TYPE[identifierType] ?? identifierType;
}

const PARTY_ROLE: Record<string, string> = {
  MANUFACTURER: "Manufacturer",
  SUPPLIER: "Supplier",
  BRAND_OWNER: "Brand owner",
};

export function partyRoleLabel(role: string): string {
  return PARTY_ROLE[role] ?? role;
}

const MATCH_STATUS: Record<string, StatusPresentation> = {
  EXACT_MATCH: { label: "Exact match", tone: "success", hint: "" },
  POSSIBLE_MATCH: {
    label: "Possible match",
    tone: "warning",
    hint: "A weaker rule matched. A person should confirm it.",
  },
  AMBIGUOUS: {
    label: "Ambiguous",
    tone: "danger",
    hint: "More than one product satisfies the same rule. Qubere will not choose between them.",
  },
  NO_MATCH: { label: "No match", tone: "neutral", hint: "" },
};

export function matchStatusPresentation(status: string): StatusPresentation {
  return MATCH_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

export const PRODUCT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "identifiers", label: "Identifiers" },
  { id: "attributes", label: "Attributes" },
  { id: "composition", label: "Composition" },
  { id: "parties", label: "Parties & manufacturing" },
  { id: "trade", label: "Trade & customs" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
] as const;

export type ProductTabId = (typeof PRODUCT_TABS)[number]["id"];

export function resolveTab(raw: string | null | undefined): ProductTabId {
  const found = PRODUCT_TABS.find((tab) => tab.id === raw);
  return found ? found.id : "overview";
}

/**
 * The one-line summary of a product's customs position.
 *
 * Deliberately does not name a single code. A product with an approved HTSUS
 * code and no EU classification is classified in the US and unclassified in the
 * EU, and a summary that said "8481.80.5090" would be read as neither.
 */
export function classificationSummary(approvedJurisdictions: readonly string[]): string {
  if (approvedJurisdictions.length === 0) {
    return "No approved classification in any jurisdiction";
  }
  return `Approved in ${[...approvedJurisdictions].sort().join(", ")}`;
}
