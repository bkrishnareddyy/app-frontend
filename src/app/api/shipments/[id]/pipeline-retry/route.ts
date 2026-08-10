import { authorizeWrite } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId, handleApiError } from "@/lib/api/error";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Re-queue a failed pipeline job.
 *
 * The queue reclaims jobs that stall mid-run (PROCESSING with a lock older than
 * five minutes), but a job that reached FAILED is terminal: nothing picks it up
 * again. Without this endpoint the workspace could only tell an operator that
 * processing had failed and leave them with no way forward, so the retry is a
 * real state change rather than a button that reloads the page.
 */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId();

  try {
    const { ctx, errorResponse } = await authorizeWrite();
    if (errorResponse) return errorResponse;
    if (!ctx) {
      return buildErrorResponse(401, "UNAUTHENTICATED", "Authentication required", requestId);
    }

    const { id } = await context.params;

    const shipment = await db.shipment.findFirst({
      where: { accountId: ctx.accountId, id, deletedAt: null },
      select: { id: true },
    });
    if (!shipment) {
      return buildErrorResponse(404, "SHIPMENT_NOT_FOUND", "Shipment not found", requestId);
    }

    const job = await db.pipelineJob.findFirst({
      where: { shipmentId: shipment.id, accountId: ctx.accountId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!job) {
      return buildErrorResponse(
        404,
        "NO_PIPELINE_JOB",
        "No pipeline run has been recorded for this shipment",
        requestId
      );
    }

    if (job.status !== "FAILED") {
      // Re-queueing a running job would let two workers hold the same state.
      return buildErrorResponse(
        409,
        "JOB_NOT_FAILED",
        `The latest pipeline run is ${job.status}. Only a failed run can be retried.`,
        requestId
      );
    }

    // Claim on the status we read, so two reviewers pressing retry produce one re-queue.
    const applied = await db.pipelineJob.updateMany({
      where: { id: job.id, accountId: ctx.accountId, status: "FAILED" },
      data: {
        status: "PENDING",
        errorMessage: null,
        lockedAt: null,
        startedAt: null,
        completedAt: null,
      },
    });

    if (applied.count === 0) {
      return buildErrorResponse(
        409,
        "JOB_NOT_FAILED",
        "The pipeline run changed before the retry was applied.",
        requestId
      );
    }

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "PIPELINE_RETRY",
      entity: "PipelineJob",
      entityId: job.id,
      metadata: { shipmentId: shipment.id },
      requestId,
    });

    return NextResponse.json({ jobId: job.id, status: "PENDING", requestId });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
