import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { inngest } from "@/lib/inngest/client";

export const maxDuration = 300;

export const POST = withCronRoute(async ({ requestId }) => {
  try {
    await inngest.send({
      name: "hts/refresh.requested",
      data: { requestId },
    });

    return NextResponse.json({
      status: "ENQUEUED",
      requestId,
      note: "99-chapter HTSUS schedule refresh enqueued as a durable background Inngest job (hts-refresh-job). Check Dataset Refresh Log for completion status.",
    });
  } catch (err: any) {
    console.error("[hts-refresh] Failed to dispatch Inngest background job:", err);
    return NextResponse.json(
      { status: "FAILED", requestId, error: err?.message || "Failed to trigger HTS refresh job" },
      { status: 500 }
    );
  }
});


