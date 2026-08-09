import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { MockCustomsTransmissionProvider } from "@/lib/providers";

/**
 * GET /api/health
 *
 * Readiness/liveness endpoint (QPR-009 req 6).
 * - Validates database connectivity.
 * - In production, asserts no mock customs transmission provider is active.
 * Returns 200 when healthy, 503 when not ready to serve production traffic.
 */
export const GET = withPublicRoute(async () => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // --- Database check ---
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    checks.database = { ok: false, detail: message };
  }

  // --- Provider check (only blocks production) ---
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    const provider = new MockCustomsTransmissionProvider();
    if (provider.isMockProvider()) {
      checks.customsProvider = {
        ok: false,
        detail:
          "PROVIDER_UNAVAILABLE: Production requires a real customs transmission provider. " +
          "MockCustomsTransmissionProvider is active.",
      };
    } else {
      checks.customsProvider = { ok: true };
    }
  } else {
    checks.customsProvider = {
      ok: true,
      detail: "Mock provider allowed in non-production environments.",
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      environment: process.env.NODE_ENV ?? "unknown",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status }
  );
});
