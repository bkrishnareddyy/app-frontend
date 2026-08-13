/**
 * The quota check for AI-invoking API routes.
 *
 * Three lines at the top of a route handler: if it returns a response, send it;
 * otherwise carry on. It goes at the route boundary and nowhere deeper, because
 * that is the last point at which refusing is free. Once an agent has begun
 * writing AgentDecision and ComplianceFinding rows against a shipment, stopping
 * it produces a half-classified shipment that no screen knows how to show — worse
 * than the overspend it was trying to prevent.
 *
 * ## What this does to existing behaviour: nothing, by default
 *
 * With none of the AI quota variables set, `checkAiQuota` counts the request and
 * allows it. Agent routes therefore behave exactly as before, and the operator
 * gets a spend history they did not have. Ceilings apply only once
 * `AI_AGENT_USER_REQUESTS_PER_MIN`, `AI_AGENT_ACCOUNT_REQUESTS_PER_MIN` or
 * `AI_ACCOUNT_TOKENS_PER_DAY` is deliberately set.
 *
 * Cron routes are not gated. A scheduled document sweep is the platform's own
 * work at a rate the platform chose, and refusing it would mean documents that
 * silently never get processed — the daily token ceiling still applies to what
 * those runs spend, which is the control that matters there.
 */

import { NextResponse } from "next/server";
import { checkAiQuota, type AiQuotaReason, type AiSurface } from "./aiQuota";

function message(reason: AiQuotaReason, retryAfterSeconds: number): string {
  if (reason === "account_tokens") {
    const hours = Math.max(1, Math.round(retryAfterSeconds / 3600));
    return `Your account has used its daily AI allowance. Automated reading and classification resume in about ${hours} hour${hours === 1 ? "" : "s"}, and an administrator can raise the limit. Everything already extracted stays available, and documents can still be uploaded and reviewed by hand.`;
  }
  if (reason === "account_requests") {
    return `Your account is running more AI tasks than its configured limit allows. Try again in about ${retryAfterSeconds} seconds.`;
  }
  return `You have started several AI tasks in quick succession. Try again in about ${retryAfterSeconds} seconds.`;
}

/**
 * Returns a 429 to send back, or null to proceed.
 *
 * The body matches `buildErrorResponse`'s envelope so clients parse it the same
 * way as every other error here. It is built by hand rather than through that
 * helper only because a 429 needs a `Retry-After` header, which the helper does
 * not set.
 */
export async function aiQuotaGate(args: {
  accountId: string;
  userId: string;
  surface: AiSurface;
  requestId: string;
}): Promise<NextResponse | null> {
  const decision = await checkAiQuota({
    accountId: args.accountId,
    userId: args.userId,
    surface: args.surface,
  });

  if (decision.allowed) return null;

  return NextResponse.json(
    {
      error: {
        code: decision.reason === "account_tokens" ? "AI_BUDGET_EXHAUSTED" : "AI_RATE_LIMITED",
        message: message(decision.reason, decision.retryAfterSeconds),
        details: { surface: args.surface, scope: decision.scope },
        requestId: args.requestId,
      },
    },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } }
  );
}
