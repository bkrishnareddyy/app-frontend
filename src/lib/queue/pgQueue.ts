import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * PG Queue: A lightweight job queue built on top of Postgres with transactional guarantees.
 * Uses `FOR UPDATE SKIP LOCKED` to atomically claim jobs.
 */

/** Job state is persisted as a JSON column, so it must be JSON-serialisable. */
export type JobState = Prisma.InputJsonObject;

/**
 * Converts a typed agent result into the JSON shape the job state column stores.
 * Typed interfaces have no index signature, so this is the single sanctioned crossing
 * point between the agent types and the JSON column.
 */
export function toJobState(value: object): JobState {
  return value as JobState;
}

export interface EnqueueOptions {
  accountId: string;
  userId: string;
  shipmentId: string;
  initialState?: JobState;
  totalSteps?: number;
  priority?: number;
}

export interface ClaimedJob {
  id: string;
  accountId: string;
  userId: string;
  shipmentId: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  priority: number;
  state: JobState;
  createdAt: Date;
}
export class PgQueue {
  /**
   * Enqueues a new pipeline job.
   */
  static async enqueueJob(options: EnqueueOptions) {
    const job = await db.pipelineJob.create({
      data: {
        accountId: options.accountId,
        userId: options.userId,
        shipmentId: options.shipmentId,
        status: "PENDING",
        currentStep: 1,
        totalSteps: options.totalSteps || 10,
        priority: options.priority || 0,
        state: options.initialState || {},
      },
    });
    return job;
  }

  /**
   * Claims one specific job by id, for callers that already know which job they are
   * about to run. Returns false when the job was already claimed by another worker.
   *
   * Use this instead of dequeueNextJob when the work is not "whatever is next in the
   * queue" — dequeueNextJob claims the highest-priority pending job across all
   * accounts, which is the wrong job for a caller that enqueued its own.
   */
  static async claimJob(jobId: string): Promise<boolean> {
    const claimed = await db.pipelineJob.updateMany({
      where: { id: jobId, status: "PENDING" },
      data: {
        status: "PROCESSING",
        lockedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return false;

    // Only the first claim sets startedAt; a job re-queued between steps keeps its
    // original start time.
    await db.pipelineJob.updateMany({
      where: { id: jobId, startedAt: null },
      data: { startedAt: new Date() },
    });
    return true;
  }

  /**
   * Atomically claims the next pending job from the queue.
   * Returns null if no jobs are available.
   */
  static async dequeueNextJob(): Promise<ClaimedJob | null> {
    // We use a raw query because Prisma does not natively support SKIP LOCKED
    // We update the status to PROCESSING and set lockedAt
    const result = await db.$queryRaw<ClaimedJob[]>`
      UPDATE "PipelineJob"
      SET 
        status = 'PROCESSING',
        "lockedAt" = NOW(),
        "updatedAt" = NOW(),
        "startedAt" = COALESCE("startedAt", NOW())
      WHERE id = (
        SELECT id 
        FROM "PipelineJob" 
        WHERE status = 'PENDING' 
           OR (status = 'PROCESSING' AND "lockedAt" < NOW() - INTERVAL '5 minutes') -- Dead letter retry
        ORDER BY priority DESC, "createdAt" ASC 
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, "accountId", "userId", "shipmentId", status, "currentStep", "totalSteps", priority, state, "createdAt";
    `;

    if (!result || result.length === 0) {
      return null;
    }

    return result[0];
  }

  /**
   * Updates the job state after a step finishes, and unlocks it so the worker can pick up the next step.
   */
  static async updateJobState(jobId: string, currentStep: number, state: JobState) {
    await db.pipelineJob.update({
      where: { id: jobId },
      data: {
        currentStep,
        state: state as Prisma.InputJsonValue,
        status: "PENDING", // Push back to queue for the next step
        lockedAt: null,
      },
    });
  }

  /**
   * Marks a job as completed.
   */
  static async completeJob(jobId: string, finalState: JobState) {
    await db.pipelineJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        state: finalState as Prisma.InputJsonValue,
        completedAt: new Date(),
        lockedAt: null,
      },
    });
  }

  /**
   * Marks a job as failed and stops it.
   */
  static async failJob(jobId: string, errorMsg: string, state: JobState = {}) {
    await db.pipelineJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        state: state as Prisma.InputJsonValue,
        errorMessage: errorMsg,
        completedAt: new Date(),
        lockedAt: null,
      },
    });
  }

  /**
   * Logs an execution of an agent step for audit trail.
   */
  static async logStepExecution(data: {
    jobId: string;
    stepNumber: number;
    agentName: string;
    status: string;
    output?: unknown;
    errorMessage?: string;
  }) {
    await db.pipelineStepExecution.create({
      data: {
        jobId: data.jobId,
        stepNumber: data.stepNumber,
        agentName: data.agentName,
        status: data.status,
        output: data.output ? (data.output as Prisma.InputJsonValue) : Prisma.JsonNull,
        errorMessage: data.errorMessage,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Enqueues an asynchronous classification engine job.
   */
  static async enqueueClassificationJob(params: {
    accountId: string;
    userId: string;
    caseId: string;
    priority?: number;
  }) {
    return db.pipelineJob.create({
      data: {
        accountId: params.accountId,
        userId: params.userId,
        shipmentId: params.caseId, // reusing shipmentId string column for caseId payload compatibility
        status: "PENDING",
        currentStep: 1,
        totalSteps: 6,
        priority: params.priority || 5,
        state: { jobType: "CLASSIFICATION_CASE", caseId: params.caseId },
      },
    });
  }

  /**
   * Enqueues an asynchronous HTS release ingestion job.
   */
  static async enqueueHtsIngestionJob(params: {
    accountId: string;
    userId: string;
    releaseName: string;
    sourceUrl: string;
  }) {
    return db.pipelineJob.create({
      data: {
        accountId: params.accountId,
        userId: params.userId,
        shipmentId: "SYS_HTS_INGESTION",
        status: "PENDING",
        currentStep: 1,
        totalSteps: 4,
        priority: 10,
        state: {
          jobType: "HTS_RELEASE_INGESTION",
          releaseName: params.releaseName,
          sourceUrl: params.sourceUrl,
        },
      },
    });
  }
}
