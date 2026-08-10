import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  // Fetch the most recent pipeline job for this shipment
  const job = await db.pipelineJob.findFirst({
    where: { shipmentId: id, accountId: ctx.accountId },
    orderBy: { createdAt: "desc" },
    include: { stepExecutions: true },
  });

  if (!job) {
    return NextResponse.json({ error: "No pipeline job found" }, { status: 404 });
  }

  // Auto-heal stuck PENDING / PROCESSING jobs from previous unhandled queues.
  // The real background pipeline (triggered synchronously by the upload
  // route right before this job was enqueued) routinely takes well past a
  // few seconds -- a 277s single-agent run has been observed live. A short
  // threshold here doesn't detect a "stuck" job, it just races the still-
  // running real pipeline: both try to build this shipment's documents
  // independently, and since this retry has no access to the original
  // upload's fileName, it falls back to a generic placeholder name and
  // creates a second, empty phantom ShipmentDocument row.
  const isStuck =
    (job.status === "PENDING" || job.status === "PROCESSING") &&
    Date.now() - new Date(job.createdAt).getTime() > 120000;

  if (isStuck) {
    try {
      const { AgentOrchestrator } = await import("@/modules/agents/agentOrchestrator");
      const { PgQueue } = await import("@/lib/queue/pgQueue");
      // Re-anchor the retry to the shipment's actual most recent document
      // instead of leaving fileName/fileUrl blank -- so if agent 1/2 do
      // re-run, their find-or-create matches the real document by name and
      // updates it, instead of fabricating a new one under a fake name.
      const latestDoc = await db.shipmentDocument.findFirst({
        where: { shipmentId: id },
        orderBy: { createdAt: "desc" },
        select: { fileName: true, fileUrl: true },
      });
      const pipelineOut = await AgentOrchestrator.runFullPipeline({
        accountId: ctx.accountId,
        userId: ctx.userId,
        shipmentId: id,
        fileName: latestDoc?.fileName,
        fileUrl: latestDoc?.fileUrl ?? undefined,
        triggerEvent: "PIPELINE_AUTO_HEAL",
        invokedBy: "System Auto-Heal (stuck job retry)",
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
});
