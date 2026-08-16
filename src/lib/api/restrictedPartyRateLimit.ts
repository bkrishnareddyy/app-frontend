/**
 * A request quota for the public restricted-party screening endpoint
 * (`POST /api/v1/screening/restricted-party`).
 *
 * Modeled on `src/modules/copilot/copilotRateLimit.ts`: an in-memory sliding
 * window, scoped by API key id rather than by user/account, since this
 * endpoint is only ever called with an API key. Same honest limitation as
 * that module -- per server instance, forgotten on cold start, a guard
 * against a runaway or misconfigured integration, not a defence against a
 * determined attacker.
 */

export interface RestrictedPartyRateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const MAX_TRACKED_KEYS = 5_000;

const buckets = new Map<string, number[]>();

function prune(hits: number[], cutoff: number): number[] {
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
  while (buckets.size > MAX_TRACKED_KEYS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

function retryAfter(hits: number[], now: number): number {
  const oldest = hits[0];
  if (oldest === undefined) return 1;
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
}

export function checkRestrictedPartyRate(keyId: string, now: number = Date.now()): RestrictedPartyRateDecision {
  const cutoff = now - WINDOW_MS;
  const hits = prune(buckets.get(keyId) ?? [], cutoff);

  if (hits.length >= MAX_PER_WINDOW) {
    buckets.set(keyId, hits);
    return { allowed: false, retryAfterSeconds: retryAfter(hits, now) };
  }

  buckets.set(keyId, [...hits, now]);
  evictIfCrowded(cutoff);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam. Never called in production code. */
export function resetRestrictedPartyRateLimits(): void {
  buckets.clear();
}
