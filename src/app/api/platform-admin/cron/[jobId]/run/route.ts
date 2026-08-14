import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";

/**
 * Fixed allowlist of cron jobs the platform-admin panel can trigger, mapped
 * to their real route + method. Keeps the client (`CronPanel.tsx`) from
 * needing the CRON_SECRET or being able to hit an arbitrary URL -- it only
 * ever sends a known job id, and this route is the only place the secret is
 * read and attached.
 */
const CRON_JOBS: Record<string, { endpoint: string; method: "GET" | "POST" }> = {
  "regulatory-ingest": { endpoint: "/api/cron/regulatory-ingest", method: "POST" },
  "hts-refresh": { endpoint: "/api/cron/hts-refresh", method: "POST" },
  "deadline-sweep": { endpoint: "/api/cron/deadline-sweep", method: "GET" },
  "document-processing": { endpoint: "/api/cron/document-processing", method: "GET" },
  "inbound-email-processing": { endpoint: "/api/cron/inbound-email-processing", method: "GET" },
};

export const POST = withAuthenticatedRoute<{ jobId: string }>(async ({ ctx, params, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const { jobId } = await params;
  const job = CRON_JOBS[jobId];
  if (!job) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Unknown cron job "${jobId}"`, requestId } },
      { status: 404 }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not configured on the server.", requestId } },
      { status: 500 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}${job.endpoint}`, {
    method: job.method,
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
});
