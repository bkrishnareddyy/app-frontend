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

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      currentStep: job.currentStep,
      totalSteps: job.totalSteps,
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
