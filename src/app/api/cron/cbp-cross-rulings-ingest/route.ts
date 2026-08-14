import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { CbpCrossFetchService } from "@/modules/regulatory/cbpCrossFetchService";
import { db } from "@/lib/db";

export const maxDuration = 300;

export const POST = withCronRoute(async ({ requestId }) => {
  try {
    // Find latest ingested ruling issue date to establish a backfill date cursor
    const latestRuling = await db.ruling.findFirst({
      orderBy: { issuedAt: "desc" },
      select: { issuedAt: true },
    });

    const startDate = latestRuling?.issuedAt
      ? new Date(latestRuling.issuedAt.getTime() - 24 * 60 * 60 * 1000) // 1 day overlap buffer
      : undefined;

    const result = await CbpCrossFetchService.fetchAndIngest({
      searchTerms: ["tariff", "classification", "duty", "solar"],
      startDate,
      maxPages: 5,
      pageSize: 50,
    });

    return NextResponse.json({
      status: "SUCCESS",
      requestId,
      count: result.count,
      cursorStartDate: startDate?.toISOString(),
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

