/**
 * How to present an AgentDecision for review, and which values on it a
 * broker can correct.
 *
 * Three categories, by how much a decision actually has to show a human:
 *
 * - MECHANICAL: pure pipeline plumbing (did the file get stitched, is the
 *   entry summary ready to file). No value to check, nothing to correct --
 *   there is nothing to ask the user, so it should not render as a
 *   reviewable line at all.
 * - FIELDS: the agent extracts (or is supposed to extract) named values --
 *   HTS code, exporter name, country of origin. Each field is either
 *   present (show it, let the broker correct it) or missing (ask the
 *   broker to provide it). Only two agent shapes are structured enough to
 *   do this safely today: HTS Classification's `proposedHtsCode` column,
 *   and Document Intelligence's flat `evidenceItems` object.
 * - NARRATIVE: real compliance judgment (origin qualification, appraised
 *   value, a compliance audit) with no structured field behind it yet --
 *   the decisionSummary sentence *is* the content. Shown as plain text,
 *   still fully reviewable (approve/reject/re-evaluate), just not editable.
 *
 * Shared between the API route (to apply an edit) and the UI (to render
 * fields and choose a category) so the two can't drift apart.
 */

export interface EditableField {
  key: string;
  label: string;
  value: string | null;
  status: "PRESENT" | "MISSING";
}

export type ReviewCategory = "MECHANICAL" | "FIELDS" | "NARRATIVE";

interface DecisionLike {
  agentName?: string | null;
  proposedHtsCode?: string | null;
  currentHtsCode?: string | null;
  evidenceItems?: unknown;
}

const DOCUMENT_INTELLIGENCE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "exporterName", label: "Exporter Name" },
  { key: "importerName", label: "Importer Name" },
  { key: "originCountry", label: "Country of Origin" },
  { key: "currency", label: "Currency" },
  { key: "invoiceSubtotal", label: "Invoice Subtotal" },
  { key: "incoterm", label: "Incoterm" },
];

// Agent names (with " Agent" already stripped, see decisionGroupLabel) that
// are pure pipeline plumbing -- pass/fail infrastructure with no compliance
// judgment and nothing a broker can correct.
const MECHANICAL_CHECKS = new Set(["Document Intake", "Filing Readiness", "Customs Filing", "Response"]);

function agentBaseName(decision: DecisionLike): string {
  return String(decision.agentName || "").replace(/\s*Agent$/i, "").trim();
}

function isHtsAgent(decision: DecisionLike): boolean {
  const name = agentBaseName(decision);
  return (
    name.includes("HTS") ||
    name.includes("Classification") ||
    Boolean(decision.proposedHtsCode) ||
    Boolean(decision.currentHtsCode)
  );
}

function flatEvidence(decision: DecisionLike): Record<string, unknown> | null {
  const items = decision.evidenceItems;
  if (!items || typeof items !== "object" || Array.isArray(items)) return null;
  return items as Record<string, unknown>;
}

/**
 * True only for the Document Intelligence shape specifically -- checked by
 * agent name (evidenceItems being "a flat object" isn't enough on its own,
 * since Product Intelligence's {profiles, reasoningChain} is also flat).
 */
function documentIntelligenceEvidence(decision: DecisionLike): Record<string, unknown> | null {
  if (!agentBaseName(decision).includes("Document Intelligence")) return null;
  return flatEvidence(decision);
}

/** Which of the three review treatments this decision gets. */
export function reviewCategory(decision: DecisionLike): ReviewCategory {
  if (isHtsAgent(decision)) return "FIELDS";
  if (documentIntelligenceEvidence(decision)) return "FIELDS";
  if (MECHANICAL_CHECKS.has(agentBaseName(decision))) return "MECHANICAL";
  return "NARRATIVE";
}

/**
 * Every field this decision is expected to carry, present or not -- present
 * fields are reviewable/correctable, missing ones are a prompt asking the
 * broker to provide the value. Only called for FIELDS-category decisions;
 * returns [] otherwise.
 */
export function editableFieldsFor(decision: DecisionLike): EditableField[] {
  if (isHtsAgent(decision)) {
    // "UNCLASSIFIABLE" is the classification agent's own sentinel for "could
    // not confidently assign a code" (htsClassificationAgent.ts) -- it is not
    // a code, so it should prompt the broker the same way a null code would.
    const raw = decision.proposedHtsCode || decision.currentHtsCode || null;
    const value = raw && raw !== "UNCLASSIFIABLE" ? raw : null;
    return [{ key: "proposedHtsCode", label: "HTS Code", value, status: value ? "PRESENT" : "MISSING" }];
  }

  const evidence = documentIntelligenceEvidence(decision);
  if (!evidence) return [];

  return DOCUMENT_INTELLIGENCE_FIELDS.map((f) => {
    const raw = evidence[f.key];
    const present = raw !== undefined && raw !== null && raw !== "";
    return { key: f.key, label: f.label, value: present ? String(raw) : null, status: present ? "PRESENT" : "MISSING" };
  });
}

/** Human label for the group these fields (or this narrative) sit under. */
export function decisionGroupLabel(decision: DecisionLike): string {
  if (isHtsAgent(decision)) return "HTS Classification";
  if (documentIntelligenceEvidence(decision)) return "Extracted Document Fields";
  return agentBaseName(decision) || "Check";
}

export function readEditableValue(decision: DecisionLike, key: string): string | null {
  const field = editableFieldsFor(decision).find((f) => f.key === key);
  return field ? field.value : null;
}

/**
 * The Prisma update payload for writing `value` to `key` on this decision, or
 * null if `key` isn't an editable field on it (present or missing) --
 * callers must reject the request rather than silently drop an edit nobody
 * can see landed.
 */
export function buildEditUpdate(
  decision: DecisionLike,
  key: string,
  value: string
): { proposedHtsCode: string } | { evidenceItems: Record<string, unknown> } | null {
  if (key === "proposedHtsCode" && isHtsAgent(decision)) {
    return { proposedHtsCode: value };
  }

  const evidence = documentIntelligenceEvidence(decision);
  const field = DOCUMENT_INTELLIGENCE_FIELDS.find((f) => f.key === key);
  if (evidence && field) {
    // Preserve the original value's type where the edit still parses as one,
    // since invoiceSubtotal is stored (and likely read elsewhere) as a number.
    const previous = evidence[field.key];
    const nextValue: unknown =
      typeof previous === "number" && value.trim() !== "" && !Number.isNaN(Number(value))
        ? Number(value)
        : value;
    return { evidenceItems: { ...evidence, [field.key]: nextValue } };
  }

  return null;
}
