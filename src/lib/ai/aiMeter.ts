/**
 * One line of metering for an agent's model call.
 *
 * The agents were written before there was any accounting, and they run in places
 * where nothing is watching: a cron sweep, a queued document, a server render of
 * a shipment page. The rule this file exists to keep is that adding accounting to
 * them changes nothing about what they produce.
 *
 * So `meterGeminiCall` cannot refuse, cannot throw, and cannot alter the response.
 * It takes what the call already returned, reads the usage the provider attached
 * to it, and records it. An agent that is metered and an agent that is not metered
 * classify identically.
 *
 * Enforcement is a separate decision made at the route, before any work starts —
 * see `checkAiQuota`. Deliberately not here: refusing halfway through a
 * classification would leave a shipment in a state no screen knows how to show.
 */

import { recordAiTokens, type AiSurface } from "./aiQuota";
import { readGeminiUsage } from "./geminiUsage";

export interface AiMeterIdentity {
  /** Whose budget this spends. A missing account means the call is not metered. */
  accountId: string | null | undefined;
  /** For per-user attribution. Falls back to the surface's system actor. */
  userId?: string | null;
}

/**
 * Records what a Gemini response cost against an account's daily total.
 *
 * `response` is typed `unknown` because the agents hold the provider's own
 * response objects and this must not constrain them; only `usageMetadata` is
 * read, and a response without it records a call with unknown cost rather than
 * failing.
 *
 * Awaited by callers so the write lands before a serverless instance can be
 * frozen, but it is two indexed upserts against a call that already took seconds,
 * so it is not a meaningful cost on the agent path.
 */
export async function meterGeminiCall(
  surface: AiSurface,
  identity: AiMeterIdentity,
  response: unknown
): Promise<void> {
  // Without an account there is nothing to bill and nothing to aggregate. Agents
  // invoked outside an account context — a platform-level backfill, say — are
  // simply not metered rather than being attributed to the wrong tenant.
  if (!identity.accountId) return;

  // `recordAiTokens` already swallows its own failures. This catch is the second
  // layer, and it is here on purpose: "metering cannot break an agent" should be
  // true of this function on its own, not only while another module keeps its
  // promise.
  try {
    const usage = readGeminiUsage(
      response && typeof response === "object"
        ? (response as { usageMetadata?: unknown }).usageMetadata
        : null
    );

    await recordAiTokens({
      accountId: identity.accountId,
      // "system" rather than a fabricated id: a cron-triggered classification has
      // no user, and inventing one would put spend on a person who was asleep.
      userId: identity.userId || "system",
      surface,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
  } catch (err) {
    console.warn(
      `[AiMeter] Usage for a ${surface} call was not recorded:`,
      err instanceof Error ? err.message : err
    );
  }
}
