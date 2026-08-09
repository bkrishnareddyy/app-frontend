import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { DomainError } from "@/lib/api/error";
import { ClassificationCaseRepository } from "@/repositories/classificationCaseRepository";
import { GriRulesEngine } from "./griRulesEngine";
import { RulingService } from "./rulingService";
import { PgQueue } from "@/lib/queue/pgQueue";
import { createAuditLog } from "@/lib/audit";

export interface CreateCaseRequest {
  accountId: string;
  userId: string;
  rawDescription: string;
  externalReference?: string;
  priority?: string;
  structuredAttributesJson?: Prisma.InputJsonObject;
  countryOfOrigin?: string;
  intendedUse?: string;
}

export interface RecordDecisionRequest {
  accountId: string;
  userId: string;
  caseId: string;
  proposalId?: string;
  approvedHtsNodeId: string;
  decisionStatus: "APPROVED" | "REJECTED" | "OVERRIDDEN";
  rationale: string;
  overrideReason?: string;
}

export class ClassificationCaseEngine {
  /**
   * Create a new classification case and enqueue asynchronous processing job.
   */
  static async createCase(req: CreateCaseRequest) {
    const classificationCase = await ClassificationCaseRepository.createCase({
      accountId: req.accountId,
      requestedByUserId: req.userId,
      externalReference: req.externalReference,
      priority: req.priority,
      rawDescription: req.rawDescription,
      structuredAttributesJson: req.structuredAttributesJson,
      countryOfOrigin: req.countryOfOrigin,
      intendedUse: req.intendedUse,
    });

    // Enqueue asynchronous processing job in PgQueue
    const job = await PgQueue.enqueueClassificationJob({
      accountId: req.accountId,
      userId: req.userId,
      caseId: classificationCase.id,
      priority: req.priority === "HIGH" ? 10 : 5,
    });

    await createAuditLog({
      accountId: req.accountId,
      userId: req.userId,
      action: "classification.case.create",
      entity: "ClassificationCase",
      entityId: classificationCase.id,
      metadata: { rawDescription: req.rawDescription, jobId: job.id },
    });

    return { classificationCase, jobId: job.id };
  }

  /**
   * Execute the asynchronous classification case pipeline (called by worker or async trigger).
   */
  static async processCase(accountId: string, userId: string, caseId: string) {
    const caseRecord = await ClassificationCaseRepository.getById(accountId, caseId);
    if (!caseRecord) {
      throw new DomainError(
        `ClassificationCase '${caseId}' not found for account '${accountId}'.`,
        "CASE_NOT_FOUND",
        404
      );
    }

    // Update status to PROCESSING
    await db.classificationCase.update({
      where: { id: caseId },
      data: { status: "PROCESSING" },
    });

    const subject = caseRecord.subjects[0];
    const rawDescription = subject?.rawDescription || "";
    const attributes = subject?.structuredAttributesJson as Record<string, unknown> | null | undefined;
    const materialComposition =
      typeof attributes?.materialComposition === "string" ? attributes.materialComposition : undefined;
    const functionUsage = typeof attributes?.functionUsage === "string" ? attributes.functionUsage : undefined;

    // Run GRI Rules Engine
    const evalOutput = await GriRulesEngine.evaluate({
      rawDescription,
      materialComposition,
      functionUsage,
      intendedUse: subject?.intendedUse,
      countryOfOrigin: subject?.countryOfOrigin,
    });

    // Create ClassificationRun
    const run = await db.classificationRun.create({
      data: {
        caseId,
        status: "COMPLETED",
        htsReleaseId: caseRecord.htsReleaseId || "CURRENT",
        promptVersion: "2026.1-GRI-DECISION-CHAIN",
        modelProvider: "QubereRulesEngine",
        modelVersion: "1.0",
        rulesEngineVersion: "1.0",
        retrievalIndexVersion: "CROSS-2026-REV1",
        completedAt: new Date(),
      },
    });

    let proposal = null;

    if (evalOutput.candidateNodeId) {
      // Find supporting rulings
      const rulings = await RulingService.searchRulings({
        query: rawDescription,
        limit: 2,
      });

      proposal = await db.classificationProposal.create({
        data: {
          runId: run.id,
          proposedHtsNodeId: evalOutput.candidateNodeId,
          rank: 1,
          calibratedConfidence: evalOutput.calibratedConfidence,
          confidenceBand: evalOutput.confidenceBand,
          recommendationStatus: evalOutput.recommendationStatus,
          summary: evalOutput.summary,
          missingFactsJson: evalOutput.missingFacts,
          griSteps: {
            create: evalOutput.griSteps.map((step) => ({
              sequence: step.sequence,
              griRule: step.griRule,
              question: step.question,
              conclusion: step.conclusion,
              outcome: step.outcome,
              deterministicChecksJson: step.deterministicChecksJson || {},
            })),
          },
          evidenceItems: {
            create: rulings.map((r) => ({
              evidenceType: "CROSS_RULING",
              sourceEntityId: r.id,
              citation: `CBP CROSS Ruling ${r.rulingNumber}`,
              quotedFragment: r.title,
              relevanceScore: 0.88,
              supportsOrConflicts: "SUPPORTS",
            })),
          },
        },
        include: {
          proposedNode: { include: { dutyRates: true } },
          griSteps: true,
          evidenceItems: true,
        },
      });
    }

    // Update case status
    const finalStatus = evalOutput.recommendationStatus;
    await db.classificationCase.update({
      where: { id: caseId },
      data: { status: finalStatus },
    });

    return { run, proposal, evalOutput };
  }

  /**
   * Record human decision (Approval / Override) with full audit log and non-mutating proposal record.
   */
  static async recordDecision(req: RecordDecisionRequest) {
    const caseRecord = await ClassificationCaseRepository.getById(req.accountId, req.caseId);
    if (!caseRecord) {
      throw new DomainError(`ClassificationCase '${req.caseId}' not found.`, "CASE_NOT_FOUND", 404);
    }

    const decision = await db.classificationDecision.create({
      data: {
        caseId: req.caseId,
        proposalId: req.proposalId || null,
        decisionStatus: req.decisionStatus,
        approvedHtsNodeId: req.approvedHtsNodeId,
        reviewerUserId: req.userId,
        rationale: req.rationale,
        overrideReason: req.overrideReason || null,
      },
      include: {
        approvedNode: true,
      },
    });

    // Update case status to APPROVED or REJECTED
    await db.classificationCase.update({
      where: { id: req.caseId },
      data: {
        status: req.decisionStatus === "APPROVED" || req.decisionStatus === "OVERRIDDEN" ? "APPROVED" : "REJECTED",
      },
    });

    await createAuditLog({
      accountId: req.accountId,
      userId: req.userId,
      action: `classification.case.${req.decisionStatus.toLowerCase()}`,
      entity: "ClassificationDecision",
      entityId: decision.id,
      metadata: {
        caseId: req.caseId,
        proposalId: req.proposalId,
        approvedHtsNodeId: req.approvedHtsNodeId,
        decisionStatus: req.decisionStatus,
      },
    });

    return decision;
  }
}
