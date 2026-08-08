import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Fetch the most recent pipeline job for this shipment
    const job = await db.pipelineJob.findFirst({
      where: { shipmentId: id, accountId: ctx.accountId },
      orderBy: { createdAt: "desc" },
      include: { stepExecutions: true },
    });

    if (!job) {
      return NextResponse.json({ error: "No pipeline job found" }, { status: 404 });
    }

    // Auto-heal stuck PENDING / PROCESSING jobs from previous unhandled queues
    const isStuck =
      (job.status === "PENDING" || job.status === "PROCESSING") &&
      Date.now() - new Date(job.createdAt).getTime() > 6000;

    if (isStuck) {
      try {
        const { AgentOrchestrator } = await import("@/modules/agents/agentOrchestrator");
        const { PgQueue } = await import("@/lib/queue/pgQueue");
        const pipelineOut = await AgentOrchestrator.runFullPipeline({
          accountId: ctx.accountId,
          userId: ctx.userId,
          shipmentId: id,
        });
        await PgQueue.completeJob(job.id, pipelineOut);
        await db.pipelineJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", currentStep: 10 },
        });
        job.status = "COMPLETED";
        job.currentStep = 10;
      } catch (err: any) {
        console.warn("Auto-heal pipeline execution error:", err);
        await db.pipelineJob.update({
          where: { id: job.id },
          data: { status: "FAILED", errorMessage: err.message },
        });
      }
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      currentStep: job.currentStep || 10,
      totalSteps: job.totalSteps || 10,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorMessage: job.errorMessage,
      stepExecutions: job.stepExecutions,
    });
  } catch (error) {
    console.error("GET /api/shipments/[id]/pipeline-status error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
