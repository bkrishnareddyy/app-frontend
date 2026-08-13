/**
 * Copilot orchestration.
 *
 * One question in, one validated answer out. The shape of a turn:
 *
 *   1. resolve what the user is looking at, through a tenant-scoped read;
 *   2. build the system prompt for this user, this context, this date;
 *   3. offer only the tools this user may use;
 *   4. retrieve — up to `maxToolIterations` rounds of the model asking for tools
 *      and the executor running them, every call checked and bounded;
 *   5. compose — a second call with no tools and a response schema;
 *   6. ground — validate the answer, drop citations the tools never returned,
 *      build every href server-side;
 *   7. audit and emit telemetry.
 *
 * Step 4 and step 5 are separate calls for a reason beyond the provider's
 * constraints: the retrieval phase's prose is discarded here, in code. It is
 * never returned, never streamed, never written to the audit table. That is how
 * "do not expose or store hidden chain-of-thought" is kept — the text does not
 * survive the function it was produced in.
 *
 * Every exit from this function is a valid CopilotAnswer. A model outage, a
 * schema violation, a timeout and an unconfigured API key all produce an honest
 * ERROR answer with a request id, because a panel showing "something went wrong"
 * with nothing to quote is not something a compliance team can report.
 */

import { randomUUID } from "node:crypto";
import type { AccountContext } from "@/lib/auth";
import { recordAiTokens } from "@/lib/ai/aiQuota";
import {
  COPILOT_SCHEMA_VERSION,
  modelAnswerSchema,
  copilotAnswerSchema,
  type CopilotAnswer,
  type CopilotAskRequest,
  type CopilotStatus,
  type ModelAnswer,
} from "./copilotContract";
import { COPILOT_ANSWER_DECLARATION } from "./copilotAnswerDeclaration";
import {
  COPILOT_LIMITS,
  copilotEnabled,
  copilotModelConfig,
  copilotModelConfigured,
} from "./copilotConfig";
import { availableTools } from "./copilotAccess";
import { COPILOT_TOOLS } from "./copilotTools";
import { CopilotLedger } from "./copilotLedger";
import { CopilotToolExecutor, type CopilotToolOutcome } from "./copilotToolExecutor";
import {
  CopilotModelError,
  createCopilotModel,
  type CopilotModelClient,
  type CopilotModelContent,
  type CopilotTokenUsage,
} from "./copilotModel";
import { resolveCopilotContext } from "./copilotContextBuilder";
import {
  COPILOT_COMPOSE_INSTRUCTION,
  buildCopilotSystemPrompt,
} from "./prompts/copilotSystemPrompt";
import {
  auditConversationStarted,
  auditError,
  auditQuery,
  auditToolExecuted,
  emitCopilotEvent,
  type CopilotAuditSubject,
} from "./copilotAudit";

export interface CopilotAskInput {
  accountId: string;
  userId: string;
  context: AccountContext;
  request: CopilotAskRequest;
  /** Injected in tests. Production resolves the configured provider. */
  model?: CopilotModelClient;
  now?: Date;
}

function formatToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A complete answer for the paths that never reach the model. Assembled through
 * the same schema the model's answer goes through, so there is one definition of
 * what the client receives.
 *
 * Exported because the route needs it too: a request refused before the service
 * runs — over quota, say — must still arrive at the panel as an answer with a
 * request id, not as a bare HTTP error the user cannot report.
 */
export function copilotFallbackAnswer(
  status: CopilotStatus,
  answer: string,
  requestId: string,
  steps: string[] = []
): CopilotAnswer {
  return copilotAnswerSchema.parse({
    schemaVersion: COPILOT_SCHEMA_VERSION,
    status,
    answer,
    entities: [],
    evidence: [],
    suggestedActions: [],
    warnings: [],
    steps,
    requestId,
  });
}

/**
 * What the provider actually said, for the server log only.
 *
 * `CopilotModelError` deliberately carries a flat message so nothing vendor-shaped
 * reaches the user, but that left "model_unavailable" as the whole diagnosis of
 * any provider failure — indistinguishable between a rejected request, an expired
 * key and an overloaded region. This reads the wrapped cause for the log line.
 *
 * The status and error name are the useful part; the message is truncated because
 * it is a provider string of unbounded length. Provider error bodies describe the
 * request that was rejected — a status, a field path, a function name — and never
 * carry the API key, so this is safe to log. It is never returned to the browser:
 * the caller still gets the fixed fallback sentence.
 */
function providerErrorDetail(error: unknown): {
  providerErrorName: string | null;
  providerErrorStatus: string | number | null;
  providerErrorMessage: string | null;
} {
  const none = {
    providerErrorName: null,
    providerErrorStatus: null,
    providerErrorMessage: null,
  };
  if (!(error instanceof CopilotModelError) || error.cause === undefined) return none;

  const cause = error.cause as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status = cause?.status ?? cause?.code;

  return {
    providerErrorName: typeof cause?.name === "string" ? cause.name : typeof cause,
    providerErrorStatus:
      typeof status === "number" || typeof status === "string" ? status : null,
    providerErrorMessage: typeof cause?.message === "string" ? cause.message.slice(0, 300) : null,
  };
}

/**
 * Running total of what a turn cost the provider. Nulls are preserved as nulls
 * until something real arrives, so "not reported" stays distinguishable from
 * "zero" in the telemetry.
 */
class UsageTally {
  private input: number | null = null;
  private output: number | null = null;
  private total: number | null = null;
  private calls = 0;

  add(usage: CopilotTokenUsage | null): void {
    this.calls += 1;
    if (!usage) return;
    if (usage.inputTokens !== null) this.input = (this.input ?? 0) + usage.inputTokens;
    if (usage.outputTokens !== null) this.output = (this.output ?? 0) + usage.outputTokens;
    if (usage.totalTokens !== null) this.total = (this.total ?? 0) + usage.totalTokens;
  }

  get detail(): {
    modelCalls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } {
    return {
      modelCalls: this.calls,
      inputTokens: this.input,
      outputTokens: this.output,
      // Providers that report only the components still yield a usable total.
      totalTokens:
        this.total ??
        (this.input === null && this.output === null ? null : (this.input ?? 0) + (this.output ?? 0)),
    };
  }
}

/**
 * Prior turns, bounded twice over: how many, and how long each may be. History
 * is replayed by the client rather than stored server-side, so it is treated as
 * untrusted text — which is fine, because it is only ever the user's own words
 * and the Copilot's own prose, both already shown on screen.
 *
 * Assistant turns are replayed as plain text with no tool results attached. The
 * model therefore cannot cite a record from three turns ago without retrieving
 * it again, and the ledger for this turn would drop it if it tried.
 */
function boundedHistory(request: CopilotAskRequest): CopilotModelContent[] {
  const turns = request.history.slice(-COPILOT_LIMITS.maxHistoryTurns);
  return turns.map((turn) => ({
    role: turn.role === "user" ? ("user" as const) : ("assistant" as const),
    text: turn.content.slice(0, COPILOT_LIMITS.maxHistoryTurnChars),
  }));
}

/** Neutral, de-duplicated progress labels. Order of first use, never why. */
function stepLabels(outcomes: CopilotToolOutcome[]): string[] {
  const labels: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.cached) continue;
    if (!labels.includes(outcome.progressLabel)) labels.push(outcome.progressLabel);
  }
  return labels.slice(0, 16);
}

function parseModelAnswer(raw: string): ModelAnswer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = modelAnswerSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function askCopilot(input: CopilotAskInput): Promise<CopilotAnswer> {
  const requestId = randomUUID();
  const conversationId = input.request.conversationId ?? requestId;
  const now = input.now ?? new Date();
  const started = Date.now();

  const subject: CopilotAuditSubject = {
    accountId: input.accountId,
    userId: input.userId,
    requestId,
    conversationId,
  };

  const modelConfig = copilotModelConfig();

  // The operator's switch, checked first and on the server, so turning the
  // Copilot off is not merely a hidden button. An injected model is still
  // honoured — tests should not depend on the deployment's flag.
  if (!input.model && !copilotEnabled()) {
    emitCopilotEvent("copilot.failed", { requestId, conversationId, reason: "disabled" });
    await auditError(subject, { stage: "configuration", reason: "copilot_disabled" });
    return copilotFallbackAnswer(
      "ERROR",
      "The Qubere AI Copilot is switched off for this environment. Products, Parties, Shipments and Documents are unaffected.",
      requestId
    );
  }

  // Checked before anything else so an unconfigured deployment says so rather
  // than failing deep inside a provider call. Not a fake success.
  if (!input.model && !copilotModelConfigured()) {
    emitCopilotEvent("copilot.failed", { requestId, conversationId, reason: "not_configured" });
    await auditError(subject, { stage: "configuration", reason: "model_not_configured" });
    return copilotFallbackAnswer(
      "ERROR",
      "The Qubere AI Copilot is not configured on this environment yet. Everything it reads is available directly in Products, Parties, Shipments and Documents in the meantime.",
      requestId
    );
  }

  const model = input.model ?? createCopilotModel(modelConfig);
  const ledger = new CopilotLedger();
  const tools = availableTools(input.context, COPILOT_TOOLS);
  const executor = new CopilotToolExecutor({
    actor: {
      accountId: input.accountId,
      userId: input.userId,
      requestId,
      context: input.context,
    },
    ledger,
  });

  const resolved = await resolveCopilotContext(
    input.accountId,
    input.context,
    input.request.context
  );

  const systemPrompt = buildCopilotSystemPrompt({
    resolvedContext: resolved.sentence,
    today: formatToday(now),
  });

  const history = boundedHistory(input.request);
  const contents: CopilotModelContent[] = [
    ...history,
    { role: "user", text: input.request.question },
  ];

  emitCopilotEvent("copilot.started", {
    requestId,
    conversationId,
    provider: model.provider,
    model: model.model,
    pageContext: input.request.context.page,
    contextResolved: resolved.entityId !== null,
    toolsOffered: tools.length,
    historyTurns: history.length,
  });

  if (input.request.history.length === 0) {
    await auditConversationStarted(subject, {
      pageContext: input.request.context.page,
      entityType: resolved.entityType,
      entityId: resolved.entityId,
    });
  }

  // One deadline for the whole turn, covering every provider call and every
  // database read, so a slow tool cannot extend a request indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COPILOT_LIMITS.requestTimeoutMs);

  const outcomes: CopilotToolOutcome[] = [];
  const tally = new UsageTally();
  let iterations = 0;
  let hitIterationCap = false;

  try {
    // -----------------------------------------------------------------------
    // Retrieval
    // -----------------------------------------------------------------------
    for (let round = 0; round < COPILOT_LIMITS.maxToolIterations; round += 1) {
      iterations = round + 1;

      const plan = await model.plan({
        systemPrompt,
        contents,
        tools,
        signal: controller.signal,
      });

      tally.add(plan.usage);

      if (plan.toolCalls.length === 0) break;

      // The model's prose from this call is not appended, not returned and not
      // stored. Only the calls it asked for continue into the transcript.
      contents.push({ role: "toolCalls", calls: plan.toolCalls });

      const results: { id: string | null; name: string; payload: Record<string, unknown> }[] = [];

      for (const call of plan.toolCalls) {
        emitCopilotEvent("copilot.tool_called", {
          requestId,
          conversationId,
          tool: call.name,
          round: iterations,
        });

        const outcome = await executor.run({ name: call.name, args: call.args });
        outcomes.push(outcome);
        results.push({ id: call.id, name: call.name, payload: outcome.payload });

        emitCopilotEvent("copilot.tool_completed", {
          requestId,
          conversationId,
          tool: outcome.name,
          ok: outcome.ok,
          code: outcome.code,
          cached: outcome.cached,
          durationMs: outcome.durationMs,
        });

        // Cached repeats performed no read, so they are not audited as one.
        if (!outcome.cached) {
          await auditToolExecuted(subject, {
            tool: outcome.name,
            ok: outcome.ok,
            code: outcome.code,
            durationMs: outcome.durationMs,
            cached: false,
          });
        }
      }

      contents.push({ role: "toolResults", results });

      if (executor.budgetExhausted) break;
      if (round === COPILOT_LIMITS.maxToolIterations - 1) hitIterationCap = true;
    }

    // -----------------------------------------------------------------------
    // Composition
    // -----------------------------------------------------------------------
    const composeContents: CopilotModelContent[] = [
      ...contents,
      { role: "user", text: COPILOT_COMPOSE_INSTRUCTION },
    ];

    const composed = await model.compose({
      systemPrompt,
      contents: composeContents,
      responseSchema: COPILOT_ANSWER_DECLARATION,
      signal: controller.signal,
    });

    tally.add(composed.usage);

    const modelAnswer = parseModelAnswer(composed.text);

    if (!modelAnswer) {
      // A response that does not satisfy the schema is not shown in any form.
      // Rendering unvalidated model output would defeat the point of having a
      // contract at all.
      emitCopilotEvent("copilot.failed", {
        requestId,
        conversationId,
        reason: "invalid_answer_schema",
        toolCalls: executor.callsMade,
        ...tally.detail,
      });
      await auditError(subject, { stage: "composition", reason: "invalid_answer_schema" });
      return copilotFallbackAnswer(
        "ERROR",
        "The Copilot could not produce a valid answer for that. Please try rephrasing the question.",
        requestId,
        stepLabels(outcomes)
      );
    }

    const steps = stepLabels(outcomes);
    const { answer, droppedCitations } = ledger.ground(modelAnswer, { requestId, steps });

    if (hitIterationCap && answer.status === "ANSWERED") {
      answer.warnings.push(
        "This answer was assembled within the Copilot's lookup limit for one question. Ask a narrower follow-up if something looks incomplete."
      );
    }

    const validated = copilotAnswerSchema.parse(answer);
    const durationMs = Date.now() - started;

    emitCopilotEvent("copilot.answer_completed", {
      requestId,
      conversationId,
      status: validated.status,
      durationMs,
      toolCalls: executor.callsMade,
      iterations,
      entities: validated.entities.length,
      evidence: validated.evidence.length,
      actions: validated.suggestedActions.length,
      droppedCitations,
      groundedRecords: ledger.size,
      ...tally.detail,
    });

    await auditQuery(subject, {
      question: input.request.question,
      status: validated.status,
      durationMs,
      toolCallsMade: executor.callsMade,
      iterations,
      entitiesCited: validated.entities.length,
      evidenceCited: validated.evidence.length,
      actionsOffered: validated.suggestedActions.length,
      droppedCitations,
      model: model.model,
      provider: model.provider,
      historyTurnsUsed: history.length,
      ...tally.detail,
    });

    return validated;
  } catch (error) {
    const aborted = controller.signal.aborted;
    const reason = aborted
      ? "timeout"
      : error instanceof CopilotModelError
        ? "model_unavailable"
        : "orchestration_failure";

    emitCopilotEvent("copilot.failed", {
      requestId,
      conversationId,
      reason,
      durationMs: Date.now() - started,
      toolCalls: executor.callsMade,
      iterations,
      // Server-side only, and only when a provider actually rejected something.
      ...providerErrorDetail(error),
      // A failed turn still cost whatever the provider already billed.
      ...tally.detail,
    });
    await auditError(subject, { stage: "orchestration", reason });

    return copilotFallbackAnswer(
      "ERROR",
      aborted
        ? "That question took too long to answer and was stopped. A narrower question — one product, one shipment — usually returns quickly."
        : "The Copilot could not answer that just now. The underlying Qubere screens are unaffected, and the data is available there.",
      requestId,
      stepLabels(outcomes)
    );
  } finally {
    clearTimeout(timeout);

    // One meter reading per turn, on every path out of the try — answered,
    // schema-violating, timed out or failed. A turn that failed halfway still
    // spent whatever the provider had already billed, and a budget that only
    // counted successes would be the wrong number to bill against.
    //
    // In `finally` rather than at each return so there is one place to be
    // correct, and awaited because the write must land before the response is
    // sent — a serverless instance can be frozen the moment it replies.
    // recordAiTokens swallows its own failures, so this cannot affect the answer.
    const spend = tally.detail;
    if (spend.modelCalls > 0) {
      await recordAiTokens({
        accountId: input.accountId,
        userId: input.userId,
        surface: "copilot",
        inputTokens: spend.inputTokens,
        outputTokens: spend.outputTokens,
        now,
      });
    }
  }
}
