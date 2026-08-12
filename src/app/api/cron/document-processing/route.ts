import { NextResponse } from "next/server";
import { pruneAiUsageWindows } from "@/lib/ai/aiQuota";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { runWorkerTick } from "@/modules/documents/processing/documentProcessingWorker";
import { runInboundEmailWorkerTick } from "@/modules/documents/processing/inboundEmailWorker";
import { parserConfigurationReport } from "@/modules/documents/parser/config";

/**
 * Drives the document processing pipeline one bounded pass at a time.
 *
 * On a long-running host, `src/worker/documentWorker.ts` calls the same
 * `runWorkerTick()` in a loop, and request handlers call it too; all three are
 * safe to run simultaneously because every state transition is a conditional
 * update against the durable Postgres run.
 *
 * A tick does not wait for the parser: it submits what is due, polls what is
 * due, finishes what is ready, and returns. A document mid-conversion is picked
 * up by the next tick, so no HTTP request is ever held open on the provider.
 *
 * GET is the entry point because that is what Vercel Cron issues, matching
 * `/api/cron/hts-refresh`. It is gated on `CRON_SECRET` and it processes only
 * work that already exists: it advances durable runs and never creates
 * documents, demo data, exceptions, or shipments.
 *
 * On Vercel this is a **daily backstop, not the pipeline**. Hobby schedules cron
 * at most once a day, and one tick cannot finish a document anyway: submission
 * sets `nextPollAt` a few seconds out, so the poll that retrieves the result
 * belongs to a later tick. The pipeline is driven from the request path instead
 * — see `advanceDocumentProcessing()` in
 * `src/modules/documents/processing/advanceProcessing.ts`. What this endpoint is
 * for is the work no request will ever touch: runs abandoned by a crashed
 * worker, and documents whose conversion outlived the invocation that uploaded
 * them.
 *
 * Also runs `runInboundEmailWorkerTick()` as the durable backstop for inbound
 * email ingestion. Vercel Hobby plans cap projects at 2 cron jobs, all daily,
 * so inbound email processing does not get its own vercel.json entry (see
 * /api/cron/inbound-email-processing, still callable directly for manual or
 * Pro-plan-scheduled use) -- it piggybacks on this existing daily slot
 * instead. The webhook's own `after()` dispatch is what makes ingestion feel
 * immediate; this is only the once-a-day safety net for whatever that missed.
 * Same arrangement as documents, arrived at independently: a request does the
 * work, and this endpoint catches what no request will.
 */

// 60 seconds is the Hobby ceiling for a function; asking for more fails the
// deployment rather than granting it. Raise this to 300 on Pro if the daily
// backstop starts running out of time on a large backlog.
export const maxDuration = 60;

function unauthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") !== `Bearer ${cronSecret}`;
}

/**
 * Housekeeping for the AI usage counters, piggybacking on the daily slot for the
 * same reason inbound email does: Hobby plans allow two cron entries and this
 * work does not deserve one of them.
 *
 * One row exists per account, user, surface and minute, so minute windows
 * accumulate quickly and nothing ever reads one from last month. Failure is
 * swallowed and reported — a metering table that cannot be swept must not turn a
 * document backstop into a 500.
 */
async function pruneUsageWindows(): Promise<number | null> {
  try {
    return await pruneAiUsageWindows();
  } catch (err) {
    console.warn(
      "[Cron] AI usage window prune skipped:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function tick(requestId: string): Promise<Response> {
  const configuration = parserConfigurationReport();
  const [result, inboundEmailResult, usageWindowsPruned] = await Promise.all([
    runWorkerTick(),
    runInboundEmailWorkerTick(),
    pruneUsageWindows(),
  ]);

  // A blocked tick is reported as 503 rather than 200-with-zeroes, so a
  // monitoring check cannot read "nothing to do" when the truth is "no parser is
  // configured, and no document will ever be parsed".
  if (result.blocker !== null) {
    return NextResponse.json(
      { status: "BLOCKED", requestId, blocker: result.blocker, configuration, inboundEmail: inboundEmailResult },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "OK",
    requestId,
    configuration: { provider: configuration.provider, mock: configuration.mock },
    tick: result,
    inboundEmail: inboundEmailResult,
    // null means the sweep failed and was skipped, which is not a blocker.
    usageWindowsPruned,
  });
}

export const GET = withPublicRoute(async ({ req, requestId }) => {
  if (unauthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return tick(requestId);
});

/** Same work, for schedulers and operators that prefer an explicit POST. */
export const POST = withPublicRoute(async ({ req, requestId }) => {
  if (unauthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return tick(requestId);
});
