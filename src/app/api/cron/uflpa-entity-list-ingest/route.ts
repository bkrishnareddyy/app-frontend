import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { UflpaEntityListIngestionService } from "@/modules/screening/uflpaEntityListIngestionService";

export const maxDuration = 60;

async function handleIngest(requestId: string) {
  try {
    const result = await UflpaEntityListIngestionService.fetchAndIngest();
    return NextResponse.json({
      status: "SUCCESS",
      requestId,
      parsedCount: result.parsedCount,
      supersededCount: result.supersededCount,
    });
  } catch (err: any) {
    console.error("[uflpa-entity-list-ingest] Execution failed:", err);
    return NextResponse.json(
      { status: "FAILED", requestId, error: err.message || "UFLPA Entity List ingestion failed" },
      { status: 502 }
    );
  }
}

export const GET = withCronRoute(async ({ requestId }) => handleIngest(requestId));

export const POST = withCronRoute(async ({ requestId }) => handleIngest(requestId));
