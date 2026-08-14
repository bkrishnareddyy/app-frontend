import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { CbpCrossFetchService } from "@/modules/regulatory/cbpCrossFetchService";

export const maxDuration = 300;

export const POST = withCronRoute(async ({ requestId }) => {
  try {
    const result = await CbpCrossFetchService.fetchAndIngest("tariff");
    return NextResponse.json({
      status: "SUCCESS",
      requestId,
      count: result.count,
      note: result.note,
    });
  } catch (err: any) {
    console.error("[cbp-cross-rulings-ingest] Execution failed:", err);
    return NextResponse.json(
      { status: "FAILED", requestId, error: err.message || "CBP CROSS Rulings ingestion failed" },
      { status: 502 }
    );
  }
});
