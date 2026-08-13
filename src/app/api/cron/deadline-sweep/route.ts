import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { sweepDeadlines } from "@/modules/deadlines/deadline.service";

/**
 * Deadline sweep — runs every 15 minutes.
 *
 * Re-evaluates all OPEN ComplianceDeadline rows:
 * - Transitions OPEN → MISSED when dueAt has passed.
 * - Creates or escalates ExceptionItem records at 72h and 24h thresholds.
 * - Does NOT recompute dueAt — that's done by recomputeShipmentDeadlines()
 *   which fires from ReconciliationEngine on every shipment-affecting event.
 *
 * Auth: CRON_SECRET bearer token (same pattern as other cron routes).
 * A missing CRON_SECRET allows the route through — dev convenience only;
 * production deployments must set the secret.
 */

export const maxDuration = 60;

function unauthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") !== `Bearer ${cronSecret}`;
}

export const GET = withPublicRoute(async ({ req }) => {
  if (unauthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepDeadlines();

  return NextResponse.json({
    ok: true,
    evaluated: result.evaluated,
    missed: result.missed,
    notified: result.notified,
  });
});
