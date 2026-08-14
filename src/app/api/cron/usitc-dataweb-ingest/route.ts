import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { TradeDataIngestionService } from "@/modules/tradeData/tradeDataIngestionService";

export const maxDuration = 300;

async function handleIngest(req: Request, requestId: string) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await TradeDataIngestionService.fetchAndIngestUsitcDataweb();
    return NextResponse.json({
      status: "SUCCESS",
      requestId,
      count: result.count,
      note: result.note,
    });
  } catch (err: any) {
    console.error("[usitc-dataweb-ingest] Failed:", err);
    return NextResponse.json(
      { status: "FAILED", requestId, error: err.message || "USITC DataWeb ingestion failed" },
      { status: 500 }
    );
  }
}

export const GET = withPublicRoute(async ({ req, requestId }) => {
  return handleIngest(req, requestId);
});

export const POST = withPublicRoute(async ({ req, requestId }) => {
  return handleIngest(req, requestId);
});
