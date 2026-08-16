/**
 * How party state is worded and coloured on screen.
 *
 * Kept pure and separate from the pages so the wording can be asserted in a
 * test, mirroring `productDisplay.ts`. The wording matters more than usual
 * here: APPROVED review status and VERIFIED registration status look alike
 * in a table unless the labels insist otherwise, and neither one is ever
 * worded as if Qubere itself concluded anything about who a party is — that
 * conclusion belongs to the reviewer named on the record.
 */

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  /** One sentence a reviewer can read. Empty string where none is needed. */
  hint: string;
}

const PARTY_STATUS: Record<string, StatusPresentation> = {
  DRAFT: { label: "Draft", tone: "neutral", hint: "Not yet in use." },
  ACTIVE: { label: "Active", tone: "success", hint: "" },
  INACTIVE: { label: "Inactive", tone: "neutral", hint: "Kept for history, not for new shipments." },
  SUPERSEDED: { label: "Superseded", tone: "neutral", hint: "Replaced by another party." },
  ARCHIVED: { label: "Archived", tone: "neutral", hint: "" },
};

export function partyStatusPresentation(status: string): StatusPresentation {
  return PARTY_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

const REVIEW_STATUS: Record<string, StatusPresentation> = {
  UNREVIEWED: {
    label: "Unreviewed",
    tone: "neutral",
    hint: "Nobody in this account has checked this party's master data.",
  },
  IN_REVIEW: { label: "In review", tone: "info", hint: "" },
  APPROVED: {
    label: "Approved",
    tone: "success",
    hint: "The master data has been reviewed. This is not a screening result and does not mean this party has been checked against any list.",
  },
  REJECTED: { label: "Rejected", tone: "danger", hint: "" },
  NEEDS_REVIEW: {
    label: "Needs review",
    tone: "warning",
    hint: "Something identity- or compliance-significant changed since this was last approved.",
  },
};

export function reviewStatusPresentation(status: string): StatusPresentation {
  return REVIEW_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

/**
 * Registration status. Only VERIFIED is a position of record — the concrete
 * wording behind "never fabricate verification".
 */
const REGISTRATION_STATUS: Record<string, StatusPresentation> = {
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

export function registrationStatusPresentation(status: string): StatusPresentation {
  return REGISTRATION_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

const SIGNIFICANCE: Record<string, StatusPresentation> = {
  NON_MATERIAL: { label: "Non-material", tone: "neutral", hint: "" },
  POTENTIALLY_COMPLIANCE_SIGNIFICANT: {
    label: "Possibly compliance-significant",
    tone: "warning",
    hint: "",
  },
  COMPLIANCE_SIGNIFICANT: { label: "Compliance-significant", tone: "danger", hint: "" },
};

export function significancePresentation(significance: string): StatusPresentation {
  return SIGNIFICANCE[significance] ?? { label: significance, tone: "neutral", hint: "" };
}

/**
 * What a revalidation flag is asking for.
 *
 * Every one of these is a request for a person to look again. None of them
 * is, or ever becomes, a screening result — resolving one means a person
 * looked, not that a screen was run. See `partyIntelligence.ts` for why
 * screening is never expressed as a flag on this list.
 */
const REVALIDATION: Record<string, { label: string; description: string }> = {
  IDENTITY_REVALIDATION_REQUIRED: {
    label: "Re-check identity",
    description: "A name or identifier this party is known by has changed. Its review status still stands until someone looks again.",
  },
  REGISTRATION_REVALIDATION_REQUIRED: {
    label: "Re-check registration",
    description: "A registration fact has changed. Any existing verification still stands until someone reviews it against evidence.",
  },
  ADDRESS_REVALIDATION_REQUIRED: {
    label: "Re-check address",
    description: "An address bearing on where this party is has changed.",
  },
  SCREENING_REVALIDATION_REQUIRED: {
    label: "Re-check screening",
    description: "Something changed that a screening result, if one exists, was based on. This is not a screening result itself.",
  },
};

export function revalidationPresentation(flag: string): { label: string; description: string } {
  return REVALIDATION[flag] ?? { label: flag, description: "" };
}

const SOURCE_TYPE: Record<string, string> = {
  DOCUMENT: "Document",
  EXTRACTED_FACT: "Extracted from a document",
  ERP: "ERP",
  CRM: "CRM",
  USER: "Entered by a user",
  CUSTOMER_DECLARATION: "Customer declaration",
  SUPPLIER_DECLARATION: "Supplier declaration",
  EXTERNAL_REGISTRY: "External registry",
  IMPORT: "Bulk import",
  AGENT: "Proposed by an agent",
  OTHER: "Other",
};

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE[sourceType] ?? sourceType;
}

const PARTY_KIND: Record<string, string> = {
  ORGANIZATION: "Organization",
  INDIVIDUAL: "Individual",
};

export function partyKindLabel(kind: string): string {
  return PARTY_KIND[kind] ?? kind;
}

const NAME_TYPE: Record<string, string> = {
  LEGAL: "Legal name",
  TRADE: "Trade name",
  DBA: "Doing business as",
  FORMER_LEGAL: "Former legal name",
  TRANSLATED: "Translated name",
};

export function nameTypeLabel(nameType: string): string {
  return NAME_TYPE[nameType] ?? nameType;
}

const IDENTIFIER_TYPE: Record<string, string> = {
  EORI: "EORI",
  DUNS: "D-U-N-S",
  LEI: "LEI",
  VAT: "VAT number",
  TAX_ID: "Tax ID",
  CUSTOMS_ID: "Customs ID",
  INTERNAL_PARTY_CODE: "Internal party code",
  CUSTOMER_NUMBER: "Customer number",
  SUPPLIER_NUMBER: "Supplier number",
  OTHER: "Other",
};

export function identifierTypeLabel(identifierType: string): string {
  return IDENTIFIER_TYPE[identifierType] ?? identifierType;
}

const ADDRESS_TYPE: Record<string, string> = {
  REGISTERED: "Registered address",
  MAILING: "Mailing address",
  BILLING: "Billing address",
  SITE: "Site address",
  OPERATING: "Operating address",
};

export function addressTypeLabel(addressType: string): string {
  return ADDRESS_TYPE[addressType] ?? addressType;
}

const ROLE_TYPE: Record<string, string> = {
  IMPORTER: "Importer",
  EXPORTER: "Exporter",
  MANUFACTURER: "Manufacturer",
  SUPPLIER: "Supplier",
  CUSTOMER: "Customer",
  CONSIGNEE: "Consignee",
  CONSIGNOR: "Consignor",
  CARRIER: "Carrier",
  FREIGHT_FORWARDER: "Freight forwarder",
  CUSTOMS_BROKER: "Customs broker",
  BUYER: "Buyer",
  SELLER: "Seller",
  NOTIFY_PARTY: "Notify party",
  OTHER: "Other",
};

export function roleTypeLabel(roleType: string): string {
  return ROLE_TYPE[roleType] ?? roleType;
}

const RELATIONSHIP_TYPE: Record<string, string> = {
  PARENT_OF: "Parent of",
  SUBSIDIARY_OF: "Subsidiary of",
  AFFILIATE_OF: "Affiliate of",
  AGENT_OF: "Agent of",
  SUCCESSOR_OF: "Successor of",
  PREDECESSOR_OF: "Predecessor of",
};

export function relationshipTypeLabel(relationshipType: string): string {
  return RELATIONSHIP_TYPE[relationshipType] ?? relationshipType;
}

/**
 * Match status. Worded so a possible match cannot be mistaken for a
 * confirmed one, and ambiguous is worded as a refusal to decide rather than
 * a weaker kind of match — matching `productDisplay.ts`'s wording exactly,
 * since the same "never guess" rule applies to party identity.
 */
const MATCH_STATUS: Record<string, StatusPresentation> = {
  EXACT_MATCH: { label: "Exact match", tone: "success", hint: "" },
  POSSIBLE_MATCH: {
    label: "Possible match",
    tone: "warning",
    hint: "A weaker rule matched. A person should confirm it before attaching.",
  },
  AMBIGUOUS: {
    label: "Ambiguous",
    tone: "danger",
    hint: "More than one party satisfies the same rule. Qubere will not choose between them, and will not merge them.",
  },
  NO_MATCH: { label: "No match", tone: "neutral", hint: "" },
};

export function matchStatusPresentation(status: string): StatusPresentation {
  return MATCH_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

/**
 * Restricted/denied-party screening status. HIT and REVIEW_REQUIRED are
 * both worded as something for a person to look at, not a conclusion —
 * only a disposition records a person's judgment. SKIPPED is never worded
 * as if it were CLEAR: no reference data loaded is not the same as clean.
 */
const RESTRICTED_PARTY_SCREENING_STATUS: Record<string, StatusPresentation> = {
  CLEAR: { label: "Clear", tone: "success", hint: "No match against the lists screened." },
  HIT: {
    label: "Hit",
    tone: "danger",
    hint: "Matched a denial-order list at or above the screening threshold. Needs a reviewer disposition.",
  },
  REVIEW_REQUIRED: {
    label: "Review required",
    tone: "warning",
    hint: "A possible match scored below the hit threshold. Needs a reviewer to look before this is dismissed.",
  },
  PARTIAL: {
    label: "Partial",
    tone: "warning",
    hint: "At least one match or red flag was found, but part of the screen could not complete.",
  },
  SKIPPED: {
    label: "Skipped",
    tone: "neutral",
    hint: "No reference data was available to screen against. This is not the same as clear.",
  },
  ERROR: { label: "Error", tone: "danger", hint: "The screen could not complete." },
  STALE: {
    label: "Stale",
    tone: "warning",
    hint: "Identity data has changed since this party was last screened. Re-screen before relying on the last result.",
  },
};

export function restrictedPartyScreeningStatusPresentation(status: string): StatusPresentation {
  return RESTRICTED_PARTY_SCREENING_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

/**
 * Reviewer disposition on a restricted-party screening result. The result
 * itself never changes once written — a disposition is the only mutable
 * judgment layer, so PENDING always means nobody has recorded one yet.
 */
const RESTRICTED_PARTY_DISPOSITION_STATUS: Record<string, StatusPresentation> = {
  PENDING: { label: "Pending review", tone: "warning", hint: "No reviewer judgment recorded yet." },
  CONFIRMED_MATCH: {
    label: "Confirmed match",
    tone: "danger",
    hint: "A reviewer confirmed this is the party on the list.",
  },
  FALSE_POSITIVE: {
    label: "False positive",
    tone: "neutral",
    hint: "A reviewer determined this is not the same party as the list entry.",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    hint: "A reviewer approved this party. Future screens will suppress this same list entry as a known false match.",
  },
  BLOCKED: { label: "Blocked", tone: "danger", hint: "A reviewer has blocked this party." },
  REQUEST_MORE_INFORMATION: {
    label: "More information requested",
    tone: "info",
    hint: "A reviewer needs more information before deciding.",
  },
};

export function restrictedPartyDispositionStatusPresentation(status: string): StatusPresentation {
  return RESTRICTED_PARTY_DISPOSITION_STATUS[status] ?? { label: status, tone: "neutral", hint: "" };
}

export const PARTY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "names", label: "Names" },
  { id: "identifiers", label: "Identifiers" },
  { id: "registrations", label: "Registrations" },
  { id: "addresses", label: "Addresses & sites" },
  { id: "contacts", label: "Contacts" },
  { id: "roles", label: "Roles" },
  { id: "relationships", label: "Relationships" },
  { id: "evidence", label: "Evidence" },
  { id: "screening", label: "Restricted party screening" },
  { id: "history", label: "History" },
] as const;

export type PartyTabId = (typeof PARTY_TABS)[number]["id"];

export function resolveTab(raw: string | null | undefined): PartyTabId {
  const found = PARTY_TABS.find((tab) => tab.id === raw);
  return found ? found.id : "overview";
}

/**
 * The one-line summary of who a party currently is, for a list row or a
 * detail header.
 *
 * Falls back through primary legal name, any active name, then the internal
 * code — never fabricating a name where none has been recorded.
 */
export function partyDisplayName(party: {
  internalPartyCode: string | null;
  names: readonly { rawName: string; isPrimary: boolean; nameType: string }[];
}): string {
  const primary = party.names.find((name) => name.isPrimary);
  if (primary) return primary.rawName;

  const legal = party.names.find((name) => name.nameType === "LEGAL");
  if (legal) return legal.rawName;

  const any = party.names[0];
  if (any) return any.rawName;

  return party.internalPartyCode ?? "Unnamed party";
}
