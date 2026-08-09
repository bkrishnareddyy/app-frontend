import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { PgQueue } from "@/lib/queue/pgQueue";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json().catch(() => ({}));

  // Resolve target shipment
  const targetShipmentId = body.shipmentId;
  if (!targetShipmentId) {
    return NextResponse.json({ error: "Shipment ID is required" }, { status: 400 });
  }

  // Dispatch to PG Queue for background orchestration
  const job = await PgQueue.enqueueJob({
    accountId: ctx.accountId,
    userId: ctx.userId,
    shipmentId: targetShipmentId,
    initialState: {
      intakeOutput: {
        fileName: body.fileName,
        fileUrl: body.fileUrl,
        mimeType: body.mimeType,
      },
    },
    totalSteps: 10,
  });

  return NextResponse.json({
    success: true,
    orchestration: "Dispatched to Qubere Autonomous Multi-Agent Suite (10 Agents)",
    jobId: job.id,
    result: { status: "processing", shipmentId: targetShipmentId },
  });
});
