import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { AgentOrchestrator } from "@/modules/agents/agentOrchestrator";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    // Resolve target shipment
    let targetShipmentId = body.shipmentId;
    if (!targetShipmentId) {
      const defaultShipment = await db.shipment.findFirst({
        where: { accountId: ctx.accountId, deletedAt: null },
      });
      targetShipmentId = defaultShipment?.id || "shp_demo_default";
    }

    // Run end-to-end multi-agent orchestration pipeline across all 10 agents
    const pipelineResult = await AgentOrchestrator.runFullPipeline({
      accountId: ctx.accountId,
      userId: ctx.userId,
      shipmentId: targetShipmentId,
      fileName: body.fileName || "Commercial_Invoice_INV-88421.pdf",
      fileUrl: body.fileUrl || "https://storage.qubere.ai/docs/inv-88421.pdf",
    });

    return NextResponse.json({
      success: true,
      orchestration: "Qubere Autonomous Multi-Agent Suite (10 Agents)",
      result: pipelineResult,
    });
  } catch (error) {
    console.error("POST /api/agents/orchestrate error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
