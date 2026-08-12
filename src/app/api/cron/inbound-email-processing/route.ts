import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
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

function unauthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") !== `Bearer ${cronSecret}`;
}

async function tick(requestId: string): Promise<Response> {
  const result = await runInboundEmailWorkerTick();
  return NextResponse.json({ status: "OK", requestId, tick: result });
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
