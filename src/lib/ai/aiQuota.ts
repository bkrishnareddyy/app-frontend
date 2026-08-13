/**
 * A shared quota and meter for everything on this platform that spends model
 * tokens.
 *
 * ## Why this exists
 *
 * Every AI surface here — the Copilot, HTS classification, document
 * intelligence, product intelligence, normalization, the compliance audit and
 * email intake — bills against one `GEMINI_API_KEY`. Until this module there was
 * exactly one limit anywhere in the codebase, an in-memory counter in front of
 * the Copilot, which means:
 *
 *   - it was per server instance, so the real ceiling was the configured ceiling
 *     times the number of warm instances, and a cold start forgot everything;
 *   - the other six surfaces had no ceiling at all.
 *
 * Counters live in Postgres because the database is the only thing every
 * instance shares. Each increment is a single atomic statement, so two instances
 * racing on the same account cannot both read "14 of 15" and both proceed.
 *
 * ## Fixed windows, not sliding
 *
 * A window is a truncated minute (for request counts) or a UTC day (for token
 * totals). That is weaker than the sliding window the in-memory limiter uses: a
 * caller can spend the tail of one minute and the head of the next, so a burst
 * of up to twice the nominal rate is possible at a boundary. It is the trade for
 * one indexed upsert instead of a read-modify-write, and for a cost guard that
 * is the right trade — stated here rather than discovered later.
 *
 * ## A limit that is not configured is not enforced
 *
 * This is the rule that keeps the module from changing how anything behaves
 * today. With no environment variables set, every call is metered and every call
 * is allowed. The Copilot keeps the request ceiling it already had; the agents
 * get ceilings only when an operator sets one.
 *
 * ## Failure is not enforcement
 *
 * If the counter cannot be read or written — the migration has not been applied
 * yet, the pool is exhausted, the database is briefly unreachable — the request
 * is ALLOWED and the decision is marked degraded. A metering table must never be
 * able to take down customs classification. Every degraded decision is logged,
 * because silence would make an outage look like normal operation.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/** The AI capabilities that spend tokens. One string per surface, stable. */
export const AI_SURFACES = [
  "copilot",
  "hts-classification",
  "document-intelligence",
  "product-intelligence",
  "normalization",
  "compliance-audit",
  "document-intake",
  "advisory",
] as const;

export type AiSurface = (typeof AI_SURFACES)[number];

/** The `userId` of the row that aggregates a whole account. Never a real id. */
export const ACCOUNT_WIDE = "*";

const MINUTE_MS = 60_000;

export interface AiQuotaLimits {
  /** Requests per minute for one user on one surface. Null means unlimited. */
  userRequestsPerMinute: number | null;
  /** Requests per minute for one account on one surface. Null means unlimited. */
  accountRequestsPerMinute: number | null;
  /** Tokens per UTC day for one account across all surfaces. Null means unlimited. */
  accountTokensPerDay: number | null;
}

export type AiQuotaReason =
  | "ok"
  | "user_requests"
  | "account_requests"
  | "account_tokens"
  | "unavailable";

export interface AiQuotaDecision {
  allowed: boolean;
  reason: AiQuotaReason;
  scope: "user" | "account" | null;
  retryAfterSeconds: number;
  /**
   * True when the counter could not be consulted and the request was allowed
   * without one. The caller should treat this as "unmetered", not as "in budget".
   */
  degraded: boolean;
}

const ALLOWED: AiQuotaDecision = {
  allowed: true,
  reason: "ok",
  scope: null,
  retryAfterSeconds: 0,
  degraded: false,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function positiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Limits for a surface.
 *
 * The Copilot's request ceiling is the one it already shipped with, so moving it
 * onto the shared counter changes where the count is kept and not what the count
 * is. Agent surfaces default to null — metered, never refused — until an
 * operator sets `AI_AGENT_USER_REQUESTS_PER_MIN` or
 * `AI_AGENT_ACCOUNT_REQUESTS_PER_MIN`. The daily token ceiling applies to every
 * surface once set, and to none while it is unset.
 */
export function aiQuotaLimits(
  surface: AiSurface,
  env: NodeJS.ProcessEnv = process.env
): AiQuotaLimits {
  const accountTokensPerDay = positiveInt(env.AI_ACCOUNT_TOKENS_PER_DAY);

  if (surface === "copilot") {
    return {
      userRequestsPerMinute: positiveInt(env.COPILOT_USER_REQUESTS_PER_MIN) ?? 15,
      accountRequestsPerMinute: positiveInt(env.COPILOT_ACCOUNT_REQUESTS_PER_MIN) ?? 60,
      accountTokensPerDay,
    };
  }

  return {
    userRequestsPerMinute: positiveInt(env.AI_AGENT_USER_REQUESTS_PER_MIN),
    accountRequestsPerMinute: positiveInt(env.AI_AGENT_ACCOUNT_REQUESTS_PER_MIN),
    accountTokensPerDay,
  };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export function minuteWindow(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
}

export function dayWindow(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function secondsUntil(end: number, now: number): number {
  return Math.max(1, Math.ceil((end - now) / 1000));
}

// ---------------------------------------------------------------------------
// Degradation reporting
// ---------------------------------------------------------------------------

/**
 * One line per process per failure kind. Enough to notice in a log search, not
 * enough to bury the log if the table is missing on a busy deployment.
 */
const reported = new Set<string>();

function reportDegraded(stage: string, surface: AiSurface, error: unknown): void {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : error instanceof Error
        ? error.name
        : "unknown";
  const key = `${stage}:${code}`;
  if (reported.has(key)) return;
  reported.add(key);

  console.log(
    JSON.stringify({
      level: "warn",
      event: "ai.quota_unavailable",
      stage,
      surface,
      // The class of failure, never the message: a driver error can carry the
      // connection string.
      code,
      note: "AI requests are being allowed without a shared quota. Check that the AiUsageWindow migration is applied.",
      ts: new Date().toISOString(),
    })
  );
}

/** Test seam. Never called in production code. */
export function resetAiQuotaReporting(): void {
  reported.clear();
}

// ---------------------------------------------------------------------------
// The atomic primitive
// ---------------------------------------------------------------------------

/**
 * Increments one window's request count, but only while it is under `limit`, and
 * returns the new count — or null when the limit had already been reached.
 *
 * The conditional `DO UPDATE ... WHERE` is what makes a refusal cost nothing: no
 * row is written, so a client that keeps retrying cannot inflate its own count
 * and hold its window open. Pass `limit: null` to increment unconditionally,
 * which is what metering-only surfaces do.
 */
async function bumpRequests(
  accountId: string,
  userId: string,
  surface: AiSurface,
  windowStart: Date,
  limit: number | null
): Promise<number | null> {
  const rows = limit === null
    ? await db.$queryRaw<{ requests: number }[]>`
        INSERT INTO "AiUsageWindow" ("id", "accountId", "userId", "surface", "windowKind", "windowStart", "requests", "updatedAt")
        VALUES (${randomUUID()}, ${accountId}, ${userId}, ${surface}, 'minute', ${windowStart}, 1, NOW())
        ON CONFLICT ("accountId", "userId", "surface", "windowKind", "windowStart")
        DO UPDATE SET "requests" = "AiUsageWindow"."requests" + 1, "updatedAt" = NOW()
        RETURNING "requests"`
    : await db.$queryRaw<{ requests: number }[]>`
        INSERT INTO "AiUsageWindow" ("id", "accountId", "userId", "surface", "windowKind", "windowStart", "requests", "updatedAt")
        VALUES (${randomUUID()}, ${accountId}, ${userId}, ${surface}, 'minute', ${windowStart}, 1, NOW())
        ON CONFLICT ("accountId", "userId", "surface", "windowKind", "windowStart")
        DO UPDATE SET "requests" = "AiUsageWindow"."requests" + 1, "updatedAt" = NOW()
        WHERE "AiUsageWindow"."requests" < ${limit}
        RETURNING "requests"`;

  return rows.length > 0 ? Number(rows[0].requests) : null;
}

/**
 * Undoes one increment. Used only when a later check in the same decision
 * refuses, so a request that never ran is not counted against the caller.
 */
async function unbumpRequests(
  accountId: string,
  userId: string,
  surface: AiSurface,
  windowStart: Date
): Promise<void> {
  await db.$executeRaw`
    UPDATE "AiUsageWindow"
    SET "requests" = GREATEST("requests" - 1, 0), "updatedAt" = NOW()
    WHERE "accountId" = ${accountId} AND "userId" = ${userId}
      AND "surface" = ${surface} AND "windowKind" = 'minute' AND "windowStart" = ${windowStart}`;
}

async function tokensUsedToday(accountId: string, windowStart: Date): Promise<number> {
  // SUM over BIGINT is `numeric`, which arrives as a BigInt or as a string
  // depending on the driver's conversion — hence the wide type and the Number()
  // below rather than an assumption about which one it is.
  const rows = await db.$queryRaw<{ total: bigint | number | string | null }[]>`
    SELECT COALESCE(SUM("inputTokens" + "outputTokens"), 0) AS total
    FROM "AiUsageWindow"
    WHERE "accountId" = ${accountId} AND "userId" = ${ACCOUNT_WIDE}
      AND "windowKind" = 'day' AND "windowStart" = ${windowStart}`;

  return Number(rows[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// The public check
// ---------------------------------------------------------------------------

export interface AiQuotaRequest {
  accountId: string;
  userId: string;
  surface: AiSurface;
  now?: Date;
  limits?: AiQuotaLimits;
}

/**
 * Counts one request and says whether it may proceed.
 *
 * Order matters. The user window is checked first so an individual runaway
 * session is attributed to that user rather than to the account, matching what
 * the in-memory limiter already reports. When the account window then refuses,
 * the user's increment is rolled back — the request never ran, so it should not
 * shorten that user's next minute.
 *
 * The token ceiling is checked before the request is allowed and is therefore
 * always slightly behind: a question that starts inside the budget can finish
 * outside it. Overshoot is bounded by one request, which is a better trade than
 * pre-estimating a cost nobody can predict.
 */
export async function checkAiQuota(request: AiQuotaRequest): Promise<AiQuotaDecision> {
  const now = request.now ?? new Date();
  const limits = request.limits ?? aiQuotaLimits(request.surface);
  const minute = minuteWindow(now);
  const nextMinute = minute.getTime() + MINUTE_MS;

  try {
    if (limits.accountTokensPerDay !== null) {
      const day = dayWindow(now);
      const used = await tokensUsedToday(request.accountId, day);
      if (used >= limits.accountTokensPerDay) {
        return {
          allowed: false,
          reason: "account_tokens",
          scope: "account",
          retryAfterSeconds: secondsUntil(day.getTime() + 24 * 60 * MINUTE_MS, now.getTime()),
          degraded: false,
        };
      }
    }

    const userCount = await bumpRequests(
      request.accountId,
      request.userId,
      request.surface,
      minute,
      limits.userRequestsPerMinute
    );

    if (userCount === null) {
      return {
        allowed: false,
        reason: "user_requests",
        scope: "user",
        retryAfterSeconds: secondsUntil(nextMinute, now.getTime()),
        degraded: false,
      };
    }

    const accountCount = await bumpRequests(
      request.accountId,
      ACCOUNT_WIDE,
      request.surface,
      minute,
      limits.accountRequestsPerMinute
    );

    if (accountCount === null) {
      // Refused after the user row was already incremented. Give it back.
      await unbumpRequests(request.accountId, request.userId, request.surface, minute);
      return {
        allowed: false,
        reason: "account_requests",
        scope: "account",
        retryAfterSeconds: secondsUntil(nextMinute, now.getTime()),
        degraded: false,
      };
    }

    return ALLOWED;
  } catch (error) {
    reportDegraded("check", request.surface, error);
    return { ...ALLOWED, reason: "unavailable", degraded: true };
  }
}

// ---------------------------------------------------------------------------
// Metering
// ---------------------------------------------------------------------------

export interface AiTokenRecord {
  accountId: string;
  userId: string;
  surface: AiSurface;
  inputTokens: number | null;
  outputTokens: number | null;
  now?: Date;
}

/**
 * Adds what a completed model call cost to today's totals, for the user and for
 * the account.
 *
 * Never throws and never rejects. It is called from inside agent code paths that
 * must produce a customs answer whatever the metering table is doing, so every
 * failure is swallowed here rather than handled at seven call sites. A null count
 * — a provider that reported nothing — is recorded as zero tokens against a real
 * request, which is the honest reading: the call happened, its cost is unknown.
 */
export async function recordAiTokens(record: AiTokenRecord): Promise<void> {
  const input = Math.max(0, Math.round(record.inputTokens ?? 0));
  const output = Math.max(0, Math.round(record.outputTokens ?? 0));
  const day = dayWindow(record.now ?? new Date());

  try {
    for (const userId of [record.userId, ACCOUNT_WIDE]) {
      await db.$executeRaw`
        INSERT INTO "AiUsageWindow" ("id", "accountId", "userId", "surface", "windowKind", "windowStart", "requests", "inputTokens", "outputTokens", "updatedAt")
        VALUES (${randomUUID()}, ${record.accountId}, ${userId}, ${record.surface}, 'day', ${day}, 1, ${input}, ${output}, NOW())
        ON CONFLICT ("accountId", "userId", "surface", "windowKind", "windowStart")
        DO UPDATE SET
          "requests" = "AiUsageWindow"."requests" + 1,
          "inputTokens" = "AiUsageWindow"."inputTokens" + ${input},
          "outputTokens" = "AiUsageWindow"."outputTokens" + ${output},
          "updatedAt" = NOW()`;
    }
  } catch (error) {
    reportDegraded("record", record.surface, error);
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Drops windows older than `olderThanDays`. One row per account, user, surface
 * and minute adds up, and nothing else in the system will ever read a minute
 * window from last month. A generous default keeps enough history for a monthly
 * spend report.
 */
export async function pruneAiUsageWindows(
  olderThanDays = 35,
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * MINUTE_MS);
  return db.$executeRaw`DELETE FROM "AiUsageWindow" WHERE "windowStart" < ${cutoff}`;
}
