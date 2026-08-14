import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { OFAC_SDN_DATASET_ID } from "@/lib/inngest/functions/ofacSdnIngest";

// OFAC's SDN.XML runs ~29MB / ~19,700 entries -- too large to parse
// synchronously inside a Vercel function. This route only enqueues the
// durable Inngest job (ofac-sdn-ingest) and returns immediately; that job
// owns the DatasetRefreshLog RUNNING/SUCCESS/FAILED lifecycle itself.
export const POST = withCronRoute(async ({ requestId }) => {
  const alreadyRunning = await db.datasetRefreshLog.findFirst({
    where: { datasetId: OFAC_SDN_DATASET_ID, status: "RUNNING" },
  });
  if (alreadyRunning) {
    return NextResponse.json(
      {
        status: "ALREADY_RUNNING",
        requestId,
        note: `OFAC SDN ingestion already has a run in progress (started ${alreadyRunning.startedAt.toISOString()}).`,
      },
      { status: 409 }
    );
  }

  await inngest.send({ name: "ofac-sdn/refresh.requested", data: { requestId } });

  return NextResponse.json({
    status: "ENQUEUED",
    requestId,
    note: "OFAC SDN + Consolidated Non-SDN ingestion enqueued as a background Inngest job. Full-list processing (~19,700 + ~500 entries) typically takes a few minutes -- check the Dataset Refresh Log for completion.",
  });
});
