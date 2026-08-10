/**
 * Which values on an AgentDecision a broker can correct, and where each one
 * actually lives.
 *
 * AgentDecision.evidenceItems is untyped Json, and its shape is entirely up to
 * whichever agent wrote it -- flat {field: value} for Document Intelligence,
 * {profiles, reasoningChain} for Product Intelligence, unset for most other
 * agents (their "value" is only a sentence inside decisionSummary, which
 * isn't a field anyone can correct). Rather than guess at a value from
 * whatever the JSON happens to contain, this module hard-codes the two
 * shapes that are actually structured enough to edit safely. Everything else
 * has no editable fields, on purpose -- a decision with no real field should
 * say so, not invent one.
 *
 * Shared between the API route (to apply an edit) and the UI (to render
 * which fields are editable) so the two can't drift apart.
 */

export interface EditableField {
  key: string;
  label: string;
  value: string | null;
}

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

function flatEvidence(decision: DecisionLike): Record<string, unknown> | null {
  const items = decision.evidenceItems;
  if (!items || typeof items !== "object" || Array.isArray(items)) return null;
  return items as Record<string, unknown>;
}

/** The fields on this decision a broker can edit, in display order. */
export function editableFieldsFor(decision: DecisionLike): EditableField[] {
  if (decision.proposedHtsCode || decision.currentHtsCode) {
    const value = decision.proposedHtsCode || decision.currentHtsCode || null;
    return [{ key: "proposedHtsCode", label: "HTS Code", value }];
  }

  const evidence = flatEvidence(decision);
  if (!evidence) return [];

  return DOCUMENT_INTELLIGENCE_FIELDS.filter(
    (f) => evidence[f.key] !== undefined && evidence[f.key] !== null
  ).map((f) => ({ key: f.key, label: f.label, value: String(evidence[f.key]) }));
}

/** Human label for the group these editable fields (or lack of them) sit under. */
export function decisionGroupLabel(decision: DecisionLike): string {
  if (decision.proposedHtsCode || decision.currentHtsCode) return "HTS Classification";
  if (flatEvidence(decision)) return "Extracted Document Fields";
  return String(decision.agentName || "Check").replace(/\s*Agent$/i, "").trim();
}

export function readEditableValue(decision: DecisionLike, key: string): string | null {
  const field = editableFieldsFor(decision).find((f) => f.key === key);
  return field ? field.value : null;
}

/**
 * The Prisma update payload for writing `value` to `key` on this decision, or
 * null if `key` isn't an editable field on it -- callers must reject the
 * request rather than silently drop an edit nobody can see landed.
 */
export function buildEditUpdate(
  decision: DecisionLike,
  key: string,
  value: string
): { proposedHtsCode: string } | { evidenceItems: Record<string, unknown> } | null {
  if (key === "proposedHtsCode" && (decision.proposedHtsCode || decision.currentHtsCode)) {
    return { proposedHtsCode: value };
  }

  const evidence = flatEvidence(decision);
  const field = DOCUMENT_INTELLIGENCE_FIELDS.find((f) => f.key === key);
  if (evidence && field && evidence[field.key] !== undefined && evidence[field.key] !== null) {
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
