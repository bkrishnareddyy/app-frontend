import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

/**
 * GET /api/health
 *
 * Readiness/liveness endpoint.
 * - Validates database connectivity.
 * - Reports which customs transmission provider is active.
 * - In production, rejects if the mock provider is still active (QPR-001 req 3).
 * Returns 200 when healthy, 503 when not ready to serve production traffic.
 */
export const GET = withPublicRoute(async () => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // ── Database check ─────────────────────────────────────────────────────────
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    checks.database = { ok: false, detail: message };
  }

  // ── Customs transmission provider check ────────────────────────────────────
  // RealAceProvider requires CBP_ABI_FILER_CODE + CBP_ABI_FILER_PASSWORD.
  // Until those are set, MockCustomsTransmissionProvider is the active
  // implementation. In production that is a hard failure.
  const hasCbpCredentials =
    !!process.env.CBP_ABI_FILER_CODE && !!process.env.CBP_ABI_FILER_PASSWORD;

  const activeProviderName = hasCbpCredentials
    ? "RealAceProvider"
    : "MockCustomsTransmissionProvider";

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !hasCbpCredentials) {
    checks.customsProvider = {
      ok: false,
      detail:
        `PROVIDER_UNAVAILABLE: Production requires RealAceProvider (a real CBP ABI provider). ` +
        `MockCustomsTransmissionProvider is active. ` +
        `Set CBP_ABI_FILER_CODE and CBP_ABI_FILER_PASSWORD to activate RealAceProvider.`,
    };
  } else {
    checks.customsProvider = {
      ok: true,
      detail: hasCbpCredentials
        ? `RealAceProvider is configured (CBP_ABI_FILER_CODE is set).`
        : `MockCustomsTransmissionProvider is active — acceptable in non-production environments.`,
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      environment: process.env.NODE_ENV ?? "unknown",
      timestamp: new Date().toISOString(),
      activeCustomsProvider: activeProviderName,
      checks,
    },
    { status }
  );
});
