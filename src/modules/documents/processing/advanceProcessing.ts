/**
 * Driving the document pipeline from the request path.
 *
 * Vercel's Hobby plan schedules cron at most once a day, and a single tick
 * cannot finish a document in any case: submission sets `nextPollAt` a few
 * seconds into the future, so the poll that retrieves the result belongs to a
 * later tick. Under a daily cron that arithmetic produces a document parsed two
 * days after it was uploaded. That is not a slow pipeline, it is a broken one.
 *
 * So requests drive it. `after()` runs this once the response has already been
 * sent — on Vercel it is implemented with `waitUntil`, which extends the
 * invocation rather than blocking the client — so the user waits for nothing and
 * the document still reaches the parser within seconds of upload. Where the
 * conversion is quick, the same invocation polls it to completion.
 *
 * This calls the same `runWorkerTick()` as the cron endpoint and the
 * long-running worker, with the same guarantee: every transition is a
 * conditional update against the durable Postgres run, so overlapping callers
 * cannot double-apply one, and running all three at once is safe.
 *
 * Like them, it drains work for **every** tenant rather than only the caller's.
 * It is a system worker that happens to be started by a request; each run is
 * processed in its own account's context, and no data crosses between them. The
 * alternative — scoping the drain to the caller's account — would leave a
 * tenant's documents stalled purely because that tenant happened to be idle.
 *
 * What this is *not* is a replacement for the backstop. An invocation can be
 * frozen, a deploy can cut it short, and a conversion can outlive the budget.
 * Anything left behind is picked up by the daily cron or by the next request
 * that calls in here, because the run state lives in Postgres and not in this
 * process.
 */

import { after } from "next/server";
import { readProcessingLimits } from "../parser/config";
import { runWorkerTick } from "./documentProcessingWorker";
import { countUnfinishedRuns } from "./processingRuns";

/**
 * Wall-clock budget for one drain.
 *
 * `after()` work runs inside the calling route's `maxDuration`, and it shares
 * that budget with the handler that ran before it — an upload has already spent
 * time hashing, storing and scanning by the time this starts. 30s leaves clear
 * air under the 60s Hobby ceiling for both, and still covers a submission plus
 * several polls at the default 5s/10s/20s backoff. An invocation killed
 * mid-poll is a provider call paid for and thrown away, so the loop stops early
 * rather than being cut off. Raise it alongside `maxDuration` on Pro.
 */
const DEFAULT_BUDGET_MS = 30_000;

/** Upper bound on one sleep between ticks, so the budget stays responsive. */
const MAX_SLEEP_MS = 5_000;

/**
 * When the last drain started on *this* instance.
 *
 * Per-instance, so it collapses a burst of polls hitting one warm lambda and
 * does nothing at all across a fleet of cold ones. That is the honest limit of
 * an in-memory throttle on serverless, and it is enough: correctness never
 * depended on it — `runWorkerTick()` is safe to run concurrently — this only
 * keeps a polling UI from spending a database round trip per request.
 */
let lastDrainStartedAt = 0;

export interface AdvanceOptions {
  /** Names the caller in logs. Not user-facing. */
  reason: string;
  /** Wall-clock budget for the drain loop. Defaults to 30s. */
  budgetMs?: number;
  /**
   * Skip entirely if a drain already started this recently on this instance.
   * Read paths should set it; a write that just enqueued work should not, since
   * its whole purpose is to get that work moving.
   */
  minIntervalMs?: number;
}

/**
 * Schedules a bounded drain of the processing pipeline after the response.
 *
 * Returns immediately and never throws. Call it from a route handler that has
 * just enqueued work, or from one a client polls while it waits.
 */
export function advanceDocumentProcessing(options: AdvanceOptions): void {
  const { reason, budgetMs = DEFAULT_BUDGET_MS, minIntervalMs = 0 } = options;

  const now = Date.now();
  if (minIntervalMs > 0 && now - lastDrainStartedAt < minIntervalMs) return;
  lastDrainStartedAt = now;

  after(async () => {
    try {
      await drain(budgetMs);
    } catch (error) {
      // The response is long gone, so there is nobody to tell. A failed drain
      // leaves every run exactly where it was, which is precisely the state the
      // cron backstop expects to find.
      console.error("[documents.advance] drain failed", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function drain(budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const limits = readProcessingLimits();

  while (Date.now() < deadline) {
    const tick = await runWorkerTick();

    // No parser configured. Spinning would not configure one, and the 503 from
    // /api/cron/document-processing is where an operator is meant to find out.
    if (tick.blocker !== null) return;

    if ((await countUnfinishedRuns()) === 0) return;

    // Something is still in flight but nothing is due yet — typically the run
    // submitted a moment ago, waiting out its poll delay. Sleep rather than
    // spin, and only for as long as the budget actually has left.
    const sleepFor = Math.min(limits.pollInitialDelayMs, MAX_SLEEP_MS, deadline - Date.now());
    if (sleepFor <= 0) return;
    await sleep(sleepFor);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
