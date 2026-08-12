import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { runWorkerTick } from "@/modules/documents/processing/documentProcessingWorker";
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
 * On Vercel this is a **daily backstop, not the pipeline**. Hobby schedules cron
 * at most once a day, and one tick cannot finish a document anyway: submission
 * sets `nextPollAt` a few seconds out, so the poll that retrieves the result
 * belongs to a later tick. The pipeline is driven from the request path instead
 * — see `advanceDocumentProcessing()` in
 * `src/modules/documents/processing/advanceProcessing.ts`. What this endpoint is
 * for is the work no request will ever touch: runs abandoned by a crashed
 * worker, and documents whose conversion outlived the invocation that uploaded
 * them.
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

async function tick(requestId: string): Promise<Response> {
  const configuration = parserConfigurationReport();
  const result = await runWorkerTick();

  // A blocked tick is reported as 503 rather than 200-with-zeroes, so a
  // monitoring check cannot read "nothing to do" when the truth is "no parser is
  // configured, and no document will ever be parsed".
  if (result.blocker !== null) {
    return NextResponse.json(
      { status: "BLOCKED", requestId, blocker: result.blocker, configuration },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "OK",
    requestId,
    configuration: { provider: configuration.provider, mock: configuration.mock },
    tick: result,
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
