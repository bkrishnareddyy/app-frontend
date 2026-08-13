/**
 * A question quota for the Copilot.
 *
 * Every other limit in the Copilot bounds one question: how many tools it may
 * call, how many rows it may read, how long it may take. None of them bound how
 * many questions arrive. A stuck client, a scripted caller or an impatient user
 * holding Enter can therefore spend model tokens and database reads without
 * limit, which is the one cost control the rest of the design does not provide.
 *
 * Two windows, because they catch different things: the per-user window catches
 * one runaway session, and the per-account window catches a script that spreads
 * itself across several users of the same tenant.
 *
 * ## What this is not
 *
 * It is an in-memory counter, per server instance. On a fleet — or on serverless,
 * where instances come and go — the effective limit is the configured limit times
 * the number of warm instances, and a cold start forgets everything. That is an
 * honest weakness and it is written here rather than in a ticket: this is a
 * guard against runaway clients and accidents, not a defence against a
 * determined attacker, and it should be replaced by a shared counter (the same
 * store any future distributed quota uses) before the Copilot is exposed to
 * untrusted callers.
 *
 * Correctness never depends on it. A request it lets through is checked by every
 * other layer exactly as before.
 */

import { COPILOT_RATE_LIMITS, type CopilotRateLimits } from "./copilotConfig";

export interface CopilotRateKey {
  accountId: string;
  userId: string;
}

export interface CopilotRateDecision {
  allowed: boolean;
  /** Which window was exhausted. Null when the request is allowed. */
  scope: "user" | "account" | null;
  /** Whole seconds until the caller's oldest recorded question falls out. */
  retryAfterSeconds: number;
}

/** Hit timestamps per key, oldest first. */
const buckets = new Map<string, number[]>();

/**
 * A ceiling on distinct keys held at once, so a burst of many accounts cannot
 * grow the map without bound. Eviction is oldest-window-first and only costs
 * accuracy for whoever has been quiet longest.
 */
const MAX_TRACKED_KEYS = 5_000;

function prune(hits: number[], cutoff: number): number[] {
  // Timestamps are appended in order, so the survivors are a suffix.
  let index = 0;
  while (index < hits.length && hits[index] <= cutoff) index += 1;
  return index === 0 ? hits : hits.slice(index);
}

function evictIfCrowded(cutoff: number): void {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, hits] of buckets) {
    const live = prune(hits, cutoff);
    if (live.length === 0) buckets.delete(key);
  }
  // Still crowded: drop insertion-oldest keys until under the ceiling.
  while (buckets.size > MAX_TRACKED_KEYS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

function retryAfter(hits: number[], now: number, windowMs: number): number {
  const oldest = hits[0];
  if (oldest === undefined) return 1;
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

/**
 * Decides whether one more question may be asked, and records it if so.
 *
 * A refused request is deliberately not recorded. Counting rejections would let
 * a client that keeps retrying hold its own window open indefinitely, turning a
 * one-minute cool-off into a permanent lockout.
 */
export function checkCopilotRate(
  key: CopilotRateKey,
  now: number = Date.now(),
  limits: CopilotRateLimits = COPILOT_RATE_LIMITS
): CopilotRateDecision {
  const cutoff = now - limits.windowMs;
  const userKey = `u:${key.accountId}:${key.userId}`;
  const accountKey = `a:${key.accountId}`;

  const userHits = prune(buckets.get(userKey) ?? [], cutoff);
  const accountHits = prune(buckets.get(accountKey) ?? [], cutoff);

  if (userHits.length >= limits.perUser) {
    buckets.set(userKey, userHits);
    buckets.set(accountKey, accountHits);
    return {
      allowed: false,
      scope: "user",
      retryAfterSeconds: retryAfter(userHits, now, limits.windowMs),
    };
  }

  if (accountHits.length >= limits.perAccount) {
    buckets.set(userKey, userHits);
    buckets.set(accountKey, accountHits);
    return {
      allowed: false,
      scope: "account",
      retryAfterSeconds: retryAfter(accountHits, now, limits.windowMs),
    };
  }

  buckets.set(userKey, [...userHits, now]);
  buckets.set(accountKey, [...accountHits, now]);
  evictIfCrowded(cutoff);

  return { allowed: true, scope: null, retryAfterSeconds: 0 };
}

/** Test seam. Never called in production code. */
export function resetCopilotRateLimits(): void {
  buckets.clear();
}
