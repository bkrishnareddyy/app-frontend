import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { runInboundEmailWorkerTick } from "@/modules/documents/processing/inboundEmailWorker";

/**
 * Durable backstop for inbound email processing.
 *
 * The webhook route already dispatches `runInboundEmailWorkerTick()`
 * immediately via `after()` for demo-speed responsiveness. This cron tick is
 * what guarantees the work eventually completes even if that dispatch never
 * finishes (cold start, timeout, crash) -- it just re-runs the same
 * idempotent tick against whatever `InboundEmail` rows are still RECEIVED or
 * ROUTED, matching `/api/cron/document-processing`'s pattern.
 */
export const maxDuration = 300;

async function tick(requestId: string): Promise<Response> {
  const result = await runInboundEmailWorkerTick();
  return NextResponse.json({ status: "OK", requestId, tick: result });
}

export const GET = withCronRoute(async ({ requestId }) => {
  return tick(requestId);
});

/** Same work, for schedulers and operators that prefer an explicit POST. */
export const POST = withCronRoute(async ({ requestId }) => {
  return tick(requestId);
});
