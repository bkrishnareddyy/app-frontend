import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { AgentOrchestrator } from "@/modules/agents/agentOrchestrator";
import { PgQueue } from "@/lib/queue/pgQueue";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
  } catch (error) {
    console.error("POST /api/agents/orchestrate error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
