import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { runWorkerTick } from "@/modules/documents/processing/documentProcessingWorker";
import { runInboundEmailWorkerTick } from "@/modules/documents/processing/inboundEmailWorker";
import { parserConfigurationReport } from "@/modules/documents/parser/config";

/**
 * Drives the document processing pipeline one bounded pass at a time.
 *
 * This is how the worker runs on a serverless host (see vercel.json). On a
 * long-running host, `src/worker/documentWorker.ts` calls the same
 * `runWorkerTick()` in a loop; both are safe to run simultaneously because every
 * state transition is a conditional update against the durable Postgres run.
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
 * Also runs `runInboundEmailWorkerTick()` as the durable backstop for inbound
 * email ingestion. Vercel Hobby plans cap projects at 2 cron jobs, all daily,
 * so inbound email processing does not get its own vercel.json entry (see
 * /api/cron/inbound-email-processing, still callable directly for manual or
 * Pro-plan-scheduled use) -- it piggybacks on this existing daily slot
 * instead. The webhook's own `after()` dispatch is what makes ingestion feel
 * immediate; this is only the once-a-day safety net for whatever that missed.
 */
export const maxDuration = 300;

function unauthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") !== `Bearer ${cronSecret}`;
}

async function tick(requestId: string): Promise<Response> {
  const configuration = parserConfigurationReport();
  const [result, inboundEmailResult] = await Promise.all([runWorkerTick(), runInboundEmailWorkerTick()]);

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
