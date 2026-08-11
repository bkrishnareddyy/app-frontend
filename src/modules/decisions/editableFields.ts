/**
 * How to present an AgentDecision for review, and which values a broker can
 * correct.
 *
 * Three categories, by how much a decision actually has to show a human:
 *
 * - MECHANICAL: pure pipeline plumbing (did the file get stitched, is the
 *   entry summary ready to file). No value to check, nothing to correct --
 *   there is nothing to ask the user, so it should not render as a
 *   reviewable line at all.
 * - FIELDS: the agent proposes one specific, well-defined value with its own
 *   database column -- today that's only HTS Classification's
 *   `proposedHtsCode`. Present or not, it's rendered as a single
 *   correctable field belonging to that decision.
 * - NARRATIVE: everything else (Document Intelligence, Origin, Valuation,
 *   Compliance, Product Intelligence) -- real content, but no
 *   decision-scoped field to edit. Shown as plain text, still fully
 *   reviewable (approve/reject/re-evaluate), just not editable here.
 *
 * Document Intelligence used to be a FIELDS decision, reading extracted
 * values out of its own `evidenceItems` copy. It isn't anymore: a shipment
 * can have several Document Intelligence decisions for the same document
 * (a real upload, a reattach event, a manual re-run), each with its own
 * independent, possibly-stale copy of the same facts, and evidenceItems only
 * ever carried 6 of the ~17 fields the agent actually extracts. The
 * document itself (ShipmentDocument.extractedJson.tradeMetadata) is the one
 * place with a single, current, complete copy -- see
 * `documentTradeFields` below, which is document-scoped rather than
 * decision-scoped and is rendered once per document, not once per decision.
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
}

// Agent names (with " Agent" already stripped, see decisionGroupLabel) that
// are pure pipeline plumbing -- pass/fail infrastructure with no compliance
// judgment and nothing a broker can correct.
const MECHANICAL_CHECKS = new Set(["Document Intake", "Filing Readiness", "Customs Filing", "Response"]);

// Mirrors EDITABLE_TRADE_METADATA_FIELDS in
// src/app/api/documents/[id]/extractions/route.ts -- keep the two in sync,
// since that route is the only place these edits are persisted.
export const DOCUMENT_TRADE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "exporterName", label: "Exporter Name" },
  { key: "importerName", label: "Importer Name" },
  { key: "originCountry", label: "Country of Origin" },
  { key: "destinationCountry", label: "Destination Country" },
  { key: "incoterm", label: "Incoterm" },
  { key: "currency", label: "Currency" },
  { key: "invoiceSubtotal", label: "Invoice Subtotal" },
  { key: "invoiceNumber", label: "Invoice Number" },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "hsHtsCode", label: "HS/HTS Code" },
  { key: "poNumber", label: "PO Number" },
  { key: "portOfLoading", label: "Port of Loading" },
  { key: "portOfDischarge", label: "Port of Discharge" },
  { key: "carrier", label: "Carrier" },
  { key: "transportDocumentNumber", label: "Transport Document Number" },
  { key: "totalWeight", label: "Total Weight" },
  { key: "totalQuantity", label: "Total Quantity" },
];

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

/** Which of the three review treatments this decision gets. */
export function reviewCategory(decision: DecisionLike): ReviewCategory {
  if (isHtsAgent(decision)) return "FIELDS";
  if (MECHANICAL_CHECKS.has(agentBaseName(decision))) return "MECHANICAL";
  return "NARRATIVE";
}

/**
 * The field(s) this decision itself is expected to carry, present or not.
 * Only HTS Classification qualifies today -- everything else's field data
 * lives on the document, see `documentTradeFields`. Only called for
 * FIELDS-category decisions; returns [] otherwise.
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
  return [];
}

/** Human label for the group this decision's field (or narrative) sits under. */
export function decisionGroupLabel(decision: DecisionLike): string {
  if (isHtsAgent(decision)) return "HTS Classification";
  return agentBaseName(decision) || "Check";
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
export function buildEditUpdate(decision: DecisionLike, key: string, value: string): { proposedHtsCode: string } | null {
  if (key === "proposedHtsCode" && isHtsAgent(decision)) {
    return { proposedHtsCode: value };
  }
  return null;
}

/**
 * The document-level fields Document Intelligence extracts, present or not,
 * read from ShipmentDocument.extractedJson.tradeMetadata -- the document's
 * single canonical copy, not any one decision's. Rendered once per
 * document, independent of how many Document Intelligence decisions exist
 * for it.
 */
export function documentTradeFields(tradeMetadata: unknown): EditableField[] {
  const source =
    tradeMetadata && typeof tradeMetadata === "object" && !Array.isArray(tradeMetadata)
      ? (tradeMetadata as Record<string, unknown>)
      : {};

  return DOCUMENT_TRADE_FIELDS.map((f) => {
    const raw = source[f.key];
    const present = raw !== undefined && raw !== null && raw !== "";
    return { key: f.key, label: f.label, value: present ? String(raw) : null, status: present ? "PRESENT" : "MISSING" };
  });
}
