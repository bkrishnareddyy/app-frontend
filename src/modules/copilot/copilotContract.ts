/**
 * The Qubere AI Copilot wire contract.
 *
 * Everything crossing a trust boundary is declared here: what the browser may
 * send, what the model is allowed to return, and what the panel finally renders.
 * Three separate shapes, deliberately not one:
 *
 *   - `copilotAskRequestSchema` — untrusted browser input. The page context in it
 *     is a *hint about what the user is looking at*, never an authorization. The
 *     server re-resolves every id through a tenant-scoped service before a single
 *     fact reaches the model. See copilotContextBuilder.ts.
 *   - `modelAnswerSchema` — what the model is permitted to emit. It carries ids
 *     and labels, never routes: a model cannot name a URL because the schema has
 *     no field for one.
 *   - `copilotAnswerSchema` — what the server, having checked every cited id
 *     against the grounding ledger and built every href itself, returns.
 *
 * A model answer becoming a Copilot answer is not a cast. It is the validation
 * step in copilotLedger.ts, and it drops anything the tools did not actually see.
 */

import { z } from "zod";

export const COPILOT_SCHEMA_VERSION = "1" as const;

// ---------------------------------------------------------------------------
// Entity and evidence references
// ---------------------------------------------------------------------------

/**
 * The Qubere record types the Copilot can talk about. Each maps to a route in
 * copilotActions.ts, and to at least one tool that can produce it. Nothing else
 * is addressable: a type outside this list fails validation rather than
 * rendering as an unlinked mystery.
 */
export const COPILOT_ENTITY_TYPES = [
  "PRODUCT",
  "PARTY",
  "SHIPMENT",
  "DOCUMENT",
  "EXCEPTION",
  "TASK",
  "DECISION",
] as const;
export type CopilotEntityType = (typeof COPILOT_ENTITY_TYPES)[number];

export const copilotEntityRefSchema = z.object({
  type: z.enum(COPILOT_ENTITY_TYPES),
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
});
export type CopilotEntityRef = z.infer<typeof copilotEntityRefSchema>;

/**
 * A pointer at provenance that already exists in Qubere. `evidenceId` is a real
 * ProductEvidence/PartyEvidence row id observed during this turn — never a
 * description the model composed to sound sourced.
 */
export const copilotEvidenceRefSchema = z.object({
  evidenceId: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  /** Free-text detail from the evidence row itself, e.g. "Page 2". */
  detail: z.string().max(200).nullable().default(null),
});
export type CopilotEvidenceRef = z.infer<typeof copilotEvidenceRefSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Every action the first release supports. All of them navigate; none of them
 * write. Adding a write action means adding it here *and* to the confirmation
 * flow described in the README — it cannot be smuggled in through the model.
 */
export const COPILOT_ACTION_TYPES = [
  "OPEN_PRODUCT",
  "OPEN_PARTY",
  "OPEN_SHIPMENT",
  "OPEN_DOCUMENT",
  "OPEN_EXCEPTION",
  "OPEN_TASK",
  "OPEN_DECISION",
  "VIEW_EVIDENCE",
] as const;
export type CopilotActionType = (typeof COPILOT_ACTION_TYPES)[number];

/** What the model may propose: a known action type against an id. No href. */
export const modelActionSchema = z.object({
  type: z.enum(COPILOT_ACTION_TYPES),
  entityId: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
});
export type ModelAction = z.infer<typeof modelActionSchema>;

/** What the client receives: the same action with a server-built route. */
export const copilotActionSchema = modelActionSchema.extend({
  href: z.string().min(1).max(300),
});
export type CopilotAction = z.infer<typeof copilotActionSchema>;

// ---------------------------------------------------------------------------
// Answer status
// ---------------------------------------------------------------------------

export const COPILOT_STATUSES = [
  "ANSWERED",
  "PARTIAL",
  "NEEDS_CLARIFICATION",
  "NOT_FOUND",
  "NOT_AUTHORIZED",
  "INSUFFICIENT_DATA",
  "ERROR",
] as const;
export type CopilotStatus = (typeof COPILOT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

export const MAX_ANSWER_CHARS = 4000;
const MAX_ENTITIES = 12;
const MAX_EVIDENCE = 12;
const MAX_ACTIONS = 6;
const MAX_WARNINGS = 6;

/**
 * The model's structured answer, before grounding checks.
 *
 * `.catch([])` rather than `.default([])` on the arrays: a model that emits
 * `entities: "none"` should lose its entity list, not fail the whole answer and
 * cost the user a turn. The prose is the part that must survive.
 */
export const modelAnswerSchema = z.object({
  status: z.enum(COPILOT_STATUSES),
  answer: z.string().min(1).max(MAX_ANSWER_CHARS),
  entities: z.array(copilotEntityRefSchema).max(MAX_ENTITIES).catch([]),
  evidence: z.array(copilotEvidenceRefSchema).max(MAX_EVIDENCE).catch([]),
  suggestedActions: z.array(modelActionSchema).max(MAX_ACTIONS).catch([]),
  warnings: z.array(z.string().min(1).max(300)).max(MAX_WARNINGS).catch([]),
});
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

// ---------------------------------------------------------------------------
// Server output
// ---------------------------------------------------------------------------

export const copilotAnswerSchema = z.object({
  schemaVersion: z.literal(COPILOT_SCHEMA_VERSION),
  status: z.enum(COPILOT_STATUSES),
  answer: z.string().min(1).max(MAX_ANSWER_CHARS),
  entities: z.array(copilotEntityRefSchema).max(MAX_ENTITIES),
  evidence: z.array(copilotEvidenceRefSchema).max(MAX_EVIDENCE),
  suggestedActions: z.array(copilotActionSchema).max(MAX_ACTIONS),
  warnings: z.array(z.string()).max(MAX_WARNINGS + 4),
  /**
   * Neutral progress labels for the tools that ran, e.g. "Checking shipment".
   * Names what was consulted; never why the model chose it. Private reasoning
   * is not carried here and is not stored.
   */
  steps: z.array(z.string().max(80)).max(16),
  /** Echoed so a support request can be tied to a server log line. */
  requestId: z.string(),
});
export type CopilotAnswer = z.infer<typeof copilotAnswerSchema>;

// ---------------------------------------------------------------------------
// Page context
// ---------------------------------------------------------------------------

export const COPILOT_PAGE_CONTEXT_TYPES = [
  "PRODUCT_DETAIL",
  "PARTY_DETAIL",
  "SHIPMENT_DETAIL",
  "DOCUMENT_DETAIL",
  "GLOBAL",
] as const;
export type CopilotPageContextType = (typeof COPILOT_PAGE_CONTEXT_TYPES)[number];

/**
 * What the panel says the user is looking at.
 *
 * `label` exists so the context chip can render before the server answers. It is
 * display-only and never reaches the model — the model sees the label the
 * *service* resolved for that id, so a renamed chip cannot rename a record.
 */
export const copilotPageContextSchema = z.object({
  page: z.enum(COPILOT_PAGE_CONTEXT_TYPES),
  entityType: z.enum(COPILOT_ENTITY_TYPES).nullable().default(null),
  entityId: z.string().min(1).max(64).nullable().default(null),
  label: z.string().max(160).nullable().default(null),
});
export type CopilotPageContext = z.infer<typeof copilotPageContextSchema>;

export const GLOBAL_PAGE_CONTEXT: CopilotPageContext = {
  page: "GLOBAL",
  entityType: null,
  entityId: null,
  label: null,
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const MAX_QUESTION_CHARS = 1000;

/** Prior turns the client replays. Bounded again server-side; see copilotConfig. */
export const copilotHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_ANSWER_CHARS),
});
export type CopilotHistoryTurn = z.infer<typeof copilotHistoryTurnSchema>;

export const copilotAskRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  /**
   * An opaque label the panel generates once per conversation so audit entries
   * for the same conversation can be read together. It is a correlation label
   * and nothing else — it grants no access, is never used in a query filter,
   * and is charset-restricted so it cannot carry anything but an identifier.
   */
  conversationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  context: copilotPageContextSchema.default(GLOBAL_PAGE_CONTEXT),
  /**
   * Capped here as well as in the service. The schema bound stops an oversized
   * body being parsed at all; the service bound is what actually decides how
   * much history the model sees.
   */
  history: z.array(copilotHistoryTurnSchema).max(40).default([]),
});
export type CopilotAskRequest = z.infer<typeof copilotAskRequestSchema>;
