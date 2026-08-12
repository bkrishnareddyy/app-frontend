import { NextResponse } from "next/server";
import { checkAiQuota, type AiQuotaReason } from "@/lib/ai/aiQuota";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { emitCopilotEvent } from "@/modules/copilot/copilotAudit";
import { copilotAskRequestSchema } from "@/modules/copilot/copilotContract";
import { checkCopilotRate } from "@/modules/copilot/copilotRateLimit";
import { askCopilot, copilotFallbackAnswer } from "@/modules/copilot/copilotService";

/**
 * What the user is told, per reason. Plain language, an idea of when to come
 * back, and — every time — the reminder that the rest of Qubere is untouched. A
 * Copilot that is temporarily unavailable must never read as an outage of the
 * customs work itself.
 */
function refusalMessage(reason: AiQuotaReason, retryAfterSeconds: number): string {
  const unaffected = "Products, Parties, Shipments and Documents are unaffected.";

  if (reason === "account_tokens") {
    const hours = Math.max(1, Math.round(retryAfterSeconds / 3600));
    return `Your account has used its daily Copilot allowance. It resets in about ${hours} hour${hours === 1 ? "" : "s"}, and an administrator can raise the limit. ${unaffected}`;
  }
  if (reason === "account_requests") {
    return `Your account has reached its Copilot question limit for the moment. Try again in about ${retryAfterSeconds} seconds — ${unaffected}`;
  }
  return `You have asked the Copilot a lot of questions in a short time. Try again in about ${retryAfterSeconds} seconds — ${unaffected}`;
}

/**
 * A refusal, as both a 429 and a renderable answer.
 *
 * The status code is for the infrastructure and the `{answer, requestId}` body is
 * for the panel, so the explanation lands in the conversation rather than as a
 * generic transport failure the user cannot act on.
 *
 * Telemetry only, no audit entry: one row per refusal would let a looping client
 * fill the account's audit trail, which is the table an auditor actually has to
 * read.
 */
function refuse(args: {
  requestId: string;
  reason: AiQuotaReason;
  scope: "user" | "account" | null;
  retryAfterSeconds: number;
}): NextResponse {
  emitCopilotEvent("copilot.failed", {
    requestId: args.requestId,
    conversationId: null,
    reason: "rate_limited",
    limit: args.reason,
    scope: args.scope,
    retryAfterSeconds: args.retryAfterSeconds,
  });

  const answer = copilotFallbackAnswer(
    "ERROR",
    refusalMessage(args.reason, args.retryAfterSeconds),
    args.requestId
  );

  return NextResponse.json(
    { answer, requestId: args.requestId },
    { status: 429, headers: { "Retry-After": String(args.retryAfterSeconds) } }
  );
}

/**
 * Ask the Qubere AI Copilot a question.
 *
 * Authenticated, and deliberately not permission-gated at the route: the Copilot
 * has no capability of its own. What a caller can learn through it is decided
 * per tool, against the same nav routes and permissions that gate the equivalent
 * screens — so a user with no access to Parties gets a Copilot with no party
 * tools, not a 403 on the whole panel.
 *
 * Registered as a read, without `write: true`, because every tool in the registry
 * is a read. The only writes a turn performs are audit entries, which the
 * read-only role is not meant to block.
 *
 * A per-user and per-account question quota is applied here rather than in the
 * service, because the point of it is to refuse before any work is done — and
 * because the service is also the unit under test, which should not depend on
 * process-wide counters.
 *
 * The body carries a page context. It is a hint about what "this product" refers
 * to and is re-resolved server-side against the caller's account before it is
 * used; see copilotContextBuilder.ts. Nothing in this body is treated as
 * authority — not the context, not the ids, and not the account.
 */
export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  // Two quotas, cheapest first, both before the body is even read: a caller over
  // quota should cost nothing but these checks. Both are keyed on the session's
  // account and user, never on anything the body claims, so neither can be
  // sidestepped by editing the request.
  //
  // The in-memory limiter is a per-instance fast path — it catches a client
  // hammering one warm instance without touching the database at all. It is not
  // the real ceiling, because it forgets on a cold start and each instance keeps
  // its own count.
  const local = checkCopilotRate({ accountId: ctx.accountId, userId: ctx.userId });
  if (!local.allowed) {
    return refuse({
      requestId,
      reason: local.scope === "account" ? "account_requests" : "user_requests",
      scope: local.scope,
      retryAfterSeconds: local.retryAfterSeconds,
    });
  }

  // The shared ceiling: one counter in Postgres, so the limit is the limit no
  // matter how many instances are warm, plus the account's daily token budget.
  // If the counter is unreachable this allows the request and says so in
  // telemetry — a metering table must not be able to take the Copilot down.
  const quota = await checkAiQuota({
    accountId: ctx.accountId,
    userId: ctx.userId,
    surface: "copilot",
  });
  if (!quota.allowed) {
    return refuse({
      requestId,
      reason: quota.reason,
      scope: quota.scope,
      retryAfterSeconds: quota.retryAfterSeconds,
    });
  }
  if (quota.degraded) {
    emitCopilotEvent("copilot.quota_degraded", { requestId, conversationId: null });
  }

  const body = await parseAndValidateBody(req, copilotAskRequestSchema, requestId);
  if ("response" in body) return body.response;

  const answer = await askCopilot({
    accountId: ctx.accountId,
    userId: ctx.userId,
    context: ctx,
    request: body.data,
  });

  // 200, as every outcome but a refused quota is. The status inside the answer
  // says whether it was answered,
  // partial, not found or failed; the panel renders all of those, and an HTTP
  // error would lose the request id the user needs to report a problem.
  return NextResponse.json({ answer, requestId });
});
