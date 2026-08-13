/**
 * Audit and observability for the Copilot.
 *
 * Two separate concerns, kept in one file because what may be recorded is the
 * same question for both.
 *
 * Audit entries go to the existing AuditLog table through the existing
 * `createAuditLog`, so a Copilot turn appears in the same trail as every other
 * account activity and needs no new table and no migration. Telemetry goes to
 * structured stdout in the shape the agent pipeline already uses.
 *
 * What is deliberately *not* recorded anywhere:
 *
 *   - the system prompt, or any part of it;
 *   - the model's retrieval-phase prose, which is working-out — the spec's "no
 *     hidden chain-of-thought", honoured by never persisting it rather than by
 *     persisting it somewhere quiet;
 *   - tool arguments and tool result bodies, which are the account's business
 *     data and are already stored in the records they came from;
 *   - document contents, credentials, or API keys.
 *
 * What *is* recorded is the question, because a compliance trail of who asked
 * the platform what is the point of the exercise, plus shapes and counts:
 * statuses, durations, which tools ran, how many citations were dropped.
 */

import { createAuditLog } from "@/lib/audit";
import type { CopilotStatus } from "./copilotContract";
import type { CopilotToolErrorCode } from "./copilotToolTypes";
import { COPILOT_PROMPT_VERSION } from "./prompts/copilotSystemPrompt";

const ENTITY = "Copilot";

export const COPILOT_AUDIT_ACTIONS = {
  conversationStarted: "COPILOT_CONVERSATION_STARTED",
  query: "COPILOT_QUERY",
  toolExecuted: "COPILOT_TOOL_EXECUTED",
  navigationAction: "COPILOT_NAVIGATION_ACTION",
  error: "COPILOT_ERROR",
} as const;

export interface CopilotAuditSubject {
  accountId: string;
  userId: string;
  requestId: string;
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type CopilotTelemetryEvent =
  | "copilot.started"
  | "copilot.tool_called"
  | "copilot.tool_completed"
  | "copilot.answer_completed"
  | "copilot.failed"
  // The shared quota counter could not be reached, so this turn ran unmetered.
  // Not a failure of the turn, which is why it is its own event and not an error.
  | "copilot.quota_degraded";

/**
 * One structured line per event. No question text and no business data: logs
 * are shipped to places with different retention rules than the database, and
 * an account's product names should not end up in all of them.
 */
export function emitCopilotEvent(
  event: CopilotTelemetryEvent,
  fields: Record<string, string | number | boolean | null>
): void {
  console.log(
    JSON.stringify({
      level: event === "copilot.failed" ? "error" : "info",
      event,
      promptVersion: COPILOT_PROMPT_VERSION,
      ...fields,
      ts: new Date().toISOString(),
    })
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** First turn of a conversation only. */
export async function auditConversationStarted(
  subject: CopilotAuditSubject,
  detail: { pageContext: string; entityType: string | null; entityId: string | null }
): Promise<void> {
  await createAuditLog({
    accountId: subject.accountId,
    userId: subject.userId,
    action: COPILOT_AUDIT_ACTIONS.conversationStarted,
    entity: ENTITY,
    entityId: subject.conversationId,
    correlationId: subject.conversationId,
    requestId: subject.requestId,
    metadata: {
      promptVersion: COPILOT_PROMPT_VERSION,
      pageContext: detail.pageContext,
      // The *resolved* context, not what the browser claimed.
      resolvedEntityType: detail.entityType,
      resolvedEntityId: detail.entityId,
    },
  });
}

export interface CopilotQueryAuditDetail {
  question: string;
  status: CopilotStatus;
  durationMs: number;
  toolCallsMade: number;
  iterations: number;
  entitiesCited: number;
  evidenceCited: number;
  actionsOffered: number;
  droppedCitations: number;
  model: string;
  provider: string;
  historyTurnsUsed: number;
  /** Provider calls made for this question. Two on a straight-through turn. */
  modelCalls: number;
  /**
   * Tokens as the provider reported them, or null where it reported nothing.
   * Kept alongside the question so cost can be attributed to an account without
   * joining the audit trail to a separate billing export.
   */
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export async function auditQuery(
  subject: CopilotAuditSubject,
  detail: CopilotQueryAuditDetail
): Promise<void> {
  await createAuditLog({
    accountId: subject.accountId,
    userId: subject.userId,
    action: COPILOT_AUDIT_ACTIONS.query,
    entity: ENTITY,
    entityId: subject.conversationId,
    correlationId: subject.conversationId,
    requestId: subject.requestId,
    // The answer text is not stored. The question, the outcome and the shape of
    // the retrieval are what an auditor needs; the prose can be reproduced from
    // the records it cited, and storing it would double the copy of the
    // account's data sitting in the audit table.
    metadata: { promptVersion: COPILOT_PROMPT_VERSION, ...detail },
    success: detail.status !== "ERROR",
  });
}

export interface CopilotToolAuditDetail {
  tool: string;
  ok: boolean;
  code: CopilotToolErrorCode | null;
  durationMs: number;
  cached: boolean;
}

/**
 * One entry per tool that actually ran. Cached repeats are skipped by the
 * caller, so the trail shows reads performed rather than reads requested.
 */
export async function auditToolExecuted(
  subject: CopilotAuditSubject,
  detail: CopilotToolAuditDetail
): Promise<void> {
  await createAuditLog({
    accountId: subject.accountId,
    userId: subject.userId,
    action: COPILOT_AUDIT_ACTIONS.toolExecuted,
    entity: ENTITY,
    entityId: subject.conversationId,
    correlationId: subject.conversationId,
    requestId: subject.requestId,
    // Tool name and outcome, never the arguments: those name the records the
    // user asked about, and the query entry already records the question.
    metadata: { promptVersion: COPILOT_PROMPT_VERSION, ...detail },
    success: detail.ok,
  });
}

export async function auditNavigationAction(
  subject: CopilotAuditSubject,
  detail: { actionType: string; entityType: string; entityId: string; href: string }
): Promise<void> {
  await createAuditLog({
    accountId: subject.accountId,
    userId: subject.userId,
    action: COPILOT_AUDIT_ACTIONS.navigationAction,
    entity: ENTITY,
    entityId: detail.entityId,
    correlationId: subject.conversationId,
    requestId: subject.requestId,
    metadata: { promptVersion: COPILOT_PROMPT_VERSION, ...detail },
  });
}

export async function auditError(
  subject: CopilotAuditSubject,
  detail: { stage: string; reason: string }
): Promise<void> {
  await createAuditLog({
    accountId: subject.accountId,
    userId: subject.userId,
    action: COPILOT_AUDIT_ACTIONS.error,
    entity: ENTITY,
    entityId: subject.conversationId,
    correlationId: subject.conversationId,
    requestId: subject.requestId,
    // `reason` is one of a fixed set of stage failures, not an exception
    // message: those can carry connection strings and column names.
    metadata: { promptVersion: COPILOT_PROMPT_VERSION, ...detail },
    success: false,
  });
}
