import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
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
 * Auth: CRON_SECRET bearer token, required. A missing or mismatched secret
 * is rejected — there is no unauthenticated fallback.
 */

export const maxDuration = 60;

export const GET = withCronRoute(async () => {
  const result = await sweepDeadlines();

  return NextResponse.json({
    ok: true,
    evaluated: result.evaluated,
    missed: result.missed,
    notified: result.notified,
  });
});
