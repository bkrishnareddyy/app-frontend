import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { BisCslIngestionService } from "@/modules/screening/bisCslIngestionService";

export const maxDuration = 300;

async function handleIngest(requestId: string) {
  try {
    // staged=false: publish directly, matching every other government-source
    // ingester (OFAC SDN, UFLPA Entity List) -- nothing in this codebase ever
    // calls publishStagedEntities(), so staging here left every BIS CSL row
    // (Entity List, DPL, MEU List, etc.) permanently stuck as DRAFT and
    // invisible to screening.
    const result = await BisCslIngestionService.fetchAndIngest(undefined, false);
    return NextResponse.json({
      status: "SUCCESS",
      requestId,
      count: result.count,
      supersededCount: result.supersededCount,
      note: result.note,
    });
  } catch (err: any) {
    console.error("[bis-csl-ingest] Execution failed:", err);
    return NextResponse.json(
      { status: "FAILED", requestId, error: err.message || "BIS CSL ingestion failed" },
      { status: 502 }
    );
  }
}

export const GET = withCronRoute(async ({ requestId }) => handleIngest(requestId));

export const POST = withCronRoute(async ({ requestId }) => handleIngest(requestId));
