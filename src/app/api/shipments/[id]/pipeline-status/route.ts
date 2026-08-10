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

  // A status poll is a read. It must not run the pipeline: this endpoint is polled
  // every few seconds by the UI, so "auto-healing" here launched a full ten-agent run
  // on every poll of a job that had merely not finished yet. Stalled jobs are reclaimed
  // by the queue worker (see pgQueue.ts dead-letter retry); we only report the condition.
  const STALL_THRESHOLD_MS = 5 * 60 * 1000;
  const isStalled =
    job.status === "PROCESSING" &&
    job.lockedAt !== null &&
    Date.now() - new Date(job.lockedAt).getTime() > STALL_THRESHOLD_MS;

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    stalled: isStalled,
    currentStep: job.currentStep,
    totalSteps: job.totalSteps,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    errorMessage: job.errorMessage,
    stepExecutions: job.stepExecutions,
  });
});
