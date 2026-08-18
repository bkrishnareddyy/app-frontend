import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { ExchangeRateService } from "@/modules/fx/exchangeRateService";

export const maxDuration = 300;

async function handleRefresh(requestId: string) {
  try {
    const result = await ExchangeRateService.fetchAndStoreRates();
    return NextResponse.json({
      status: "SUCCESS",
      requestId,
      count: result.count,
      note: result.note,
    });
  } catch (err: any) {
    console.error("[fx-rate-refresh] Execution failed:", err);
    return NextResponse.json(
      { status: "FAILED", requestId, error: err.message || "FX rate refresh failed" },
      { status: 502 }
    );
  }
}

export const GET = withCronRoute(async ({ requestId }) => handleRefresh(requestId));

export const POST = withCronRoute(async ({ requestId }) => handleRefresh(requestId));
