import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { DomainError } from "@/lib/api/error";
import { ClassificationCaseRepository } from "@/repositories/classificationCaseRepository";
import { GriRulesEngine } from "./griRulesEngine";
import { RulingService } from "./rulingService";
import { PgQueue } from "@/lib/queue/pgQueue";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { HTSClassificationAgent } from "@/modules/agents/htsClassificationAgent";
import { HtsNodeRepository } from "@/repositories/htsNodeRepository";

export interface CreateCaseRequest {
  accountId: string;
  userId: string;
  rawDescription: string;
  productId?: string;
  lineItemId?: string;
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
  changeReason?: string;
  isRollback?: boolean;
}

export class ClassificationCaseEngine {
  /**
   * Create or return existing classification case for the given product/description.
   * One case per productId per account (idempotent for productId).
   */
  static async createCase(req: CreateCaseRequest) {
    // A-1: idempotency — if a productId is provided, return the existing open case.
    if (req.productId) {
      const canonicalProduct = await db.canonicalProduct.findFirst({
        where: { accountId: req.accountId, productId: req.productId },
        select: { id: true },
      });

      if (canonicalProduct) {
        const existing = await db.classificationCase.findFirst({
          where: {
            accountId: req.accountId,
            status: { notIn: ["APPROVED", "REJECTED", "CANCELLED"] },
            subjects: { some: { canonicalProductId: canonicalProduct.id } },
          },
          include: { subjects: true, documents: true },
        });

        if (existing) {
          return { classificationCase: existing, jobId: null, isExisting: true };
        }
      }
    }

    // Look up canonicalProductId for the subject if productId provided
    let canonicalProductId: string | undefined;
    if (req.productId) {
      const cp = await db.canonicalProduct.findFirst({
        where: { accountId: req.accountId, productId: req.productId },
        select: { id: true },
      });
      canonicalProductId = cp?.id;
    }

    const classificationCase = await db.classificationCase.create({
      data: {
        accountId: req.accountId,
        requestedByUserId: req.userId,
        externalReference: req.externalReference,
        priority: req.priority || "MEDIUM",
        status: "DRAFT",
        subjects: {
          create: [
            {
              rawDescription: req.rawDescription,
              structuredAttributesJson: req.structuredAttributesJson || {},
              countryOfOrigin: req.countryOfOrigin,
              intendedUse: req.intendedUse,
              ...(canonicalProductId ? { canonicalProductId } : {}),
            },
          ],
        },
      },
      include: { subjects: true, documents: true },
    });

    const job = await PgQueue.enqueueClassificationJob({
      accountId: req.accountId,
      userId: req.userId,
      caseId: classificationCase.id,
      priority: req.priority === "HIGH" ? 10 : 5,
    });

    await createAuditLog({
      accountId: req.accountId,
      userId: req.userId,
      action: AuditAction.CLASSIFICATION_CASE_CREATED,
      entity: "ClassificationCase",
      entityId: classificationCase.id,
      source: "UI",
      metadata: {
        rawDescription: req.rawDescription,
        jobId: job.id,
        productId: req.productId,
      },
    });

    return { classificationCase, jobId: job.id, isExisting: false };
  }

  /**
   * Trigger an async classification run for a case.
   * Creates the ClassificationRun record immediately and enqueues processing.
   * Returns { runId, status: "QUEUED" } (A-2).
   */
  static async triggerRun(accountId: string, userId: string, caseId: string) {
    const caseRecord = await ClassificationCaseRepository.getById(accountId, caseId);
    if (!caseRecord) {
      throw new DomainError(`ClassificationCase '${caseId}' not found.`, "CASE_NOT_FOUND", 404);
    }

    const run = await db.classificationRun.create({
      data: {
        caseId,
        status: "RUNNING",
        htsReleaseId: caseRecord.htsReleaseId || "CURRENT",
        promptVersion: "2026.1-GRI-DECISION-CHAIN",
        modelProvider: process.env.GEMINI_API_KEY ? "GeminiHTSAgent+GRIChain" : "QubereRulesEngine",
        modelVersion: "1.0",
        rulesEngineVersion: "1.0",
        retrievalIndexVersion: "CROSS-2026-REV1",
      },
    });

    // Process synchronously (no Inngest in this build; PgQueue worker picks it up on next tick)
    ClassificationCaseEngine.processCase(accountId, userId, caseId, run.id).catch(() => {
      // Worker failure is non-fatal; the run stays in RUNNING and can be retried
    });

    return { runId: run.id, status: "QUEUED" as const };
  }

  /**
   * Execute the classification pipeline for a case (called by worker or triggerRun).
   *
   * Primary path: HTSClassificationAgent (Gemini-backed, GRI 1–6 legal reasoning,
   * real HTSUS duty rates).  GriRulesEngine always runs after to produce the
   * deterministic step provenance chain stored on the proposal.  When Gemini is
   * unavailable the engine falls back to GriRulesEngine alone.
   */
  static async processCase(
    accountId: string,
    userId: string,
    caseId: string,
    existingRunId?: string
  ) {
    const caseRecord = await ClassificationCaseRepository.getById(accountId, caseId);
    if (!caseRecord) {
      throw new DomainError(
        `ClassificationCase '${caseId}' not found for account '${accountId}'.`,
        "CASE_NOT_FOUND",
        404
      );
    }

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

    // ------------------------------------------------------------------
    // Primary: HTSClassificationAgent (Gemini, GRI legal reasoning)
    // Sentinel shipmentId carries the case id so AgentDecision rows written
    // by the agent are traceable back to this case without violating any
    // FK constraint (shipmentId is a plain string column).
    // ------------------------------------------------------------------
    let agentHtsCode: string | null = null;
    let agentConfidence: number | null = null;
    let agentGriCitations: string[] = [];
    let agentLegalRationale: string | null = null;
    let agentDutyRate: string | null = null;
    let modelProvider = "QubereRulesEngine";

    if (process.env.GEMINI_API_KEY && rawDescription.trim().length > 3) {
      try {
        const agentOutput = await HTSClassificationAgent.execute({
          accountId,
          userId,
          shipmentId: `case:${caseId}`,
          documentId: null,
          productProfiles: [
            {
              lineNumber: 1,
              rawDescription,
              materialComposition: materialComposition ?? null,
              endUse: functionUsage ?? null,
              // intendedUse maps to endUse in the agent's profile
            },
          ],
          countryOfOrigin: subject?.countryOfOrigin ?? null,
        });

        const classification = agentOutput.classifications?.[0];
        if (classification && classification.htsCode && classification.htsCode !== "UNCLASSIFIABLE") {
          agentHtsCode = classification.htsCode;
          // Agent returns 0–100 integer; proposals store 0–1 float
          agentConfidence = classification.confidence / 100;
          agentGriCitations = classification.griCitations ?? [];
          agentLegalRationale = classification.legalRationale ?? null;
          agentDutyRate = classification.dutyRate ?? null;
          modelProvider = agentOutput.aiProviderUsed || "GeminiHTSAgent+GRIChain";
        }
      } catch {
        // Agent failure is non-fatal; fall through to GRI-only path
      }
    }

    // ------------------------------------------------------------------
    // Always run GriRulesEngine — produces the deterministic GRI step
    // provenance chain regardless of whether the agent ran.
    // ------------------------------------------------------------------
    const evalOutput = await GriRulesEngine.evaluate({
      rawDescription,
      materialComposition,
      functionUsage,
      intendedUse: subject?.intendedUse,
      countryOfOrigin: subject?.countryOfOrigin,
    });

    // ------------------------------------------------------------------
    // Resolve the HTS node to store on the proposal.  When the agent
    // returned a code, look it up first; fall back to the GRI engine's
    // candidate if the agent code doesn't resolve.
    // ------------------------------------------------------------------
    let resolvedNodeId: string | null = evalOutput.candidateNodeId ?? null;
    if (agentHtsCode) {
      try {
        const normalizedAgentCode = agentHtsCode.replace(/[^0-9]/g, "");
        const agentNode = normalizedAgentCode
          ? await HtsNodeRepository.findByNormalizedCode(normalizedAgentCode)
          : null;
        if (agentNode) resolvedNodeId = agentNode.id;
      } catch {
        // Fallback to GRI candidate — already set
      }
    }

    // Merge: prefer agent values where present, GRI engine as fallback
    const finalConfidence = agentConfidence ?? evalOutput.calibratedConfidence;
    const finalConfidenceBand = agentConfidence != null
      ? (agentConfidence >= 0.80 ? "HIGH" : agentConfidence >= 0.55 ? "MEDIUM" : "LOW")
      : evalOutput.confidenceBand;
    const finalRecommendationStatus = agentConfidence != null
      ? (finalConfidenceBand === "HIGH" ? "PROPOSED" : finalConfidenceBand === "MEDIUM" ? "HUMAN_REVIEW_REQUIRED" : "NEEDS_INFORMATION")
      : evalOutput.recommendationStatus;
    const finalSummary = agentLegalRationale
      ? `${agentLegalRationale} (HTS ${agentHtsCode ?? evalOutput.candidateHtsCode ?? "UNCLASSIFIABLE"}, duty rate: ${agentDutyRate ?? "—"})`
      : evalOutput.summary;

    const run = existingRunId
      ? await db.classificationRun.update({
          where: { id: existingRunId },
          data: { status: "COMPLETED", completedAt: new Date() },
        })
      : await db.classificationRun.create({
          data: {
            caseId,
            status: "COMPLETED",
            htsReleaseId: caseRecord.htsReleaseId || "CURRENT",
            promptVersion: "2026.1-GRI-DECISION-CHAIN",
            modelProvider,
            modelVersion: "1.0",
            rulesEngineVersion: "1.0",
            retrievalIndexVersion: "CROSS-2026-REV1",
            completedAt: new Date(),
          },
        });

    let proposal = null;

    if (resolvedNodeId) {
      // Match rulings against the resolved HTS code (not just the raw
      // description) so evidence items are actually code-relevant.
      const rulings = await RulingService.searchRulings({
        htsCode: agentHtsCode ?? evalOutput.candidateHtsCode,
        query: rawDescription,
        limit: 3,
      });

      proposal = await db.classificationProposal.create({
        data: {
          runId: run.id,
          proposedHtsNodeId: resolvedNodeId,
          rank: 1,
          calibratedConfidence: finalConfidence,
          confidenceBand: finalConfidenceBand,
          recommendationStatus: finalRecommendationStatus,
          summary: finalSummary,
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
            create: [
              // GRI citations from the agent as evidence items
              ...agentGriCitations.map((cite) => ({
                evidenceType: "GRI_CITATION",
                sourceEntityId: caseId,
                citation: cite,
                quotedFragment: cite,
                relevanceScore: 0.95,
                supportsOrConflicts: "SUPPORTS",
              })),
              // CROSS rulings matched by HTS code
              // relevanceScore is computed per-ruling: if the ruling's stored
              // htsReferences contain a code that shares a prefix with the
              // resolved code (at least 4 digits), it is a strong match (0.97);
              // otherwise the ruling matched only via text/title search (0.75).
              ...rulings.map((r) => {
                const resolvedPrefix = (agentHtsCode ?? evalOutput.candidateHtsCode ?? "")
                  .replace(/[^0-9]/g, "")
                  .slice(0, 6);
                const htsPrefixMatch =
                  resolvedPrefix.length >= 4 &&
                  r.htsReferences.some((ref: { htsNumberDisplay: string }) =>
                    ref.htsNumberDisplay.replace(/[^0-9]/g, "").startsWith(resolvedPrefix)
                  );
                return {
                  evidenceType: "CROSS_RULING",
                  sourceEntityId: r.id,
                  citation: `CBP CROSS Ruling ${r.rulingNumber}`,
                  quotedFragment: r.title,
                  relevanceScore: htsPrefixMatch ? 0.97 : 0.75,
                  supportsOrConflicts: "SUPPORTS",
                };
              }),
            ],
          },
        },
        include: {
          proposedNode: { include: { dutyRates: true } },
          griSteps: true,
          evidenceItems: true,
        },
      });
    }

    const finalStatus = finalRecommendationStatus;
    await db.classificationCase.update({
      where: { id: caseId },
      data: { status: finalStatus },
    });

    return { run, proposal, evalOutput };
  }

  /**
   * Record human decision and update ProductClassification (A-5).
   * Also triggers change impact computation (F-1).
   */
  static async recordDecision(req: RecordDecisionRequest) {
    const caseRecord = await ClassificationCaseRepository.getById(req.accountId, req.caseId);
    if (!caseRecord) {
      throw new DomainError(`ClassificationCase '${req.caseId}' not found.`, "CASE_NOT_FOUND", 404);
    }

    const isOverride =
      req.decisionStatus === "OVERRIDDEN" ||
      (req.proposalId
        ? await (async () => {
            const topProposal = await db.classificationProposal.findFirst({
              where: { run: { caseId: req.caseId } },
              orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
              select: { proposedHtsNodeId: true },
            });
            return topProposal ? topProposal.proposedHtsNodeId !== req.approvedHtsNodeId : false;
          })()
        : false);

    const decision = await db.classificationDecision.create({
      data: {
        caseId: req.caseId,
        proposalId: req.proposalId || null,
        decisionStatus: req.decisionStatus,
        approvedHtsNodeId: req.approvedHtsNodeId,
        reviewerUserId: req.userId,
        rationale: req.rationale,
        overrideReason: isOverride ? req.overrideReason : null,
      },
      include: { approvedNode: { include: { dutyRates: true } } },
    });

    await db.classificationCase.update({
      where: { id: req.caseId },
      data: {
        status: req.decisionStatus === "APPROVED" || req.decisionStatus === "OVERRIDDEN" ? "APPROVED" : "REJECTED",
      },
    });

    // A-5: update ProductClassification if the case has a subject linked to a product
    if (req.decisionStatus !== "REJECTED") {
      const subject = caseRecord.subjects[0];
      if (subject?.canonicalProductId) {
        const canonicalProduct = await db.canonicalProduct.findUnique({
          where: { id: subject.canonicalProductId },
          select: { productId: true },
        });

        if (canonicalProduct?.productId) {
          await ClassificationCaseEngine.upsertProductClassification({
            accountId: req.accountId,
            userId: req.userId,
            productId: canonicalProduct.productId,
            htsNodeId: req.approvedHtsNodeId,
            htsNode: decision.approvedNode,
            isOverride,
            changeReason: req.changeReason,
            isRollback: req.isRollback,
          });
        }
      }
    }

    // F-1: compute change impact
    if (req.decisionStatus !== "REJECTED") {
      ClassificationCaseEngine.computeChangeImpact(
        req.accountId,
        decision.id,
        decision.approvedNode.htsNumberDisplay,
        caseRecord.subjects
      ).catch(() => {});
    }

    await createAuditLog({
      accountId: req.accountId,
      userId: req.userId,
      action: `classification.case.${req.decisionStatus.toLowerCase()}`,
      entity: "ClassificationDecision",
      entityId: decision.id,
      source: "UI",
      metadata: {
        caseId: req.caseId,
        proposalId: req.proposalId,
        approvedHtsNodeId: req.approvedHtsNodeId,
        decisionStatus: req.decisionStatus,
        isOverride,
      },
    });

    return decision;
  }

  /** Upsert ProductClassification, superseding the previous approved entry. */
  private static async upsertProductClassification(opts: {
    accountId: string;
    userId: string;
    productId: string;
    htsNodeId: string;
    htsNode: { htsNumberDisplay: string; description: string | null };
    isOverride: boolean;
    changeReason?: string;
    isRollback?: boolean;
  }) {
    const { accountId, userId, productId, htsNode } = opts;
    const normalizedCode = htsNode.htsNumberDisplay.replace(/[^0-9]/g, "");

    // Supersede the current APPROVED entry for US/HTSUS
    const previous = await db.productClassification.findFirst({
      where: { productId, accountId, jurisdiction: "US", nomenclature: "HTSUS", status: "APPROVED" },
      orderBy: { effectiveFrom: "desc" },
    });

    const newClassification = await db.productClassification.create({
      data: {
        accountId,
        productId,
        jurisdiction: "US",
        nomenclature: "HTSUS",
        classificationCode: htsNode.htsNumberDisplay,
        normalizedCode,
        description: htsNode.description,
        status: "APPROVED",
        decisionSource: "USER",
        decisionMethod: opts.isOverride ? "RULING_BASED" : "AGENT_PROPOSED",
        effectiveFrom: new Date(),
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNote: opts.changeReason,
      },
    });

    if (previous) {
      await db.productClassification.update({
        where: { id: previous.id },
        data: { supersededById: newClassification.id, effectiveTo: new Date() },
      });
    }

    return newClassification;
  }

  /**
   * F-1, F-2: Compute change impact for a classification decision.
   * Finds affected shipments/filings and writes ClassificationChangeImpact rows.
   */
  static async computeChangeImpact(
    accountId: string,
    decisionId: string,
    newHtsCode: string,
    subjects: Array<{ canonicalProductId?: string | null }>
  ) {
    const canonicalProductId = subjects[0]?.canonicalProductId;
    if (!canonicalProductId) return;

    const canonicalProduct = await db.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
      select: { productId: true, htsCode: true },
    });
    if (!canonicalProduct?.productId) return;

    const lineItems = await db.shipmentLineItem.findMany({
      where: { productId: canonicalProduct.productId, shipment: { accountId } },
      select: { id: true, shipmentId: true, totalValue: true },
      take: 200,
    });

    const shipmentIds = [...new Set(lineItems.map((li) => li.shipmentId))];
    const shipments = await db.shipment.findMany({
      where: { id: { in: shipmentIds }, accountId },
      include: { customsFilings: { select: { id: true, filingStatus: true }, take: 1 } },
    });
    const shipmentMap = new Map(shipments.map((s) => [s.id, s]));

    const previousHtsCode = canonicalProduct.htsCode ?? undefined;

    // ------------------------------------------------------------------
    // Resolve the General ad-valorem duty rates for both HTS codes so we
    // can compute a real duty-impact delta per line item (F05-C3, F05-F2).
    // We look up by htsNumberDisplay prefix match; if a node doesn't exist
    // or carries no parsed ad-valorem rate the effective rate is 0.
    // ------------------------------------------------------------------
    const getAdValoremRate = async (htsCode: string | undefined): Promise<Decimal> => {
      if (!htsCode) return new Decimal(0);
      const normalized = htsCode.replace(/[^0-9]/g, "");
      const node = await db.htsNode.findFirst({
        where: { normalizedCode: { startsWith: normalized.slice(0, 10) } },
        include: { dutyRates: { where: { rateColumn: "General", rateType: "AdValorem" } } },
      });
      const rate = node?.dutyRates?.[0]?.adValoremPercent;
      return rate != null ? new Decimal(rate).div(100) : new Decimal(0);
    };

    const [newRate, prevRate] = await Promise.all([
      getAdValoremRate(newHtsCode),
      getAdValoremRate(previousHtsCode),
    ]);

    for (const item of lineItems) {
      const shipment = shipmentMap.get(item.shipmentId);
      const filing = shipment?.customsFilings[0];

      // dutyImpact = totalValue * (newRate − prevRate); negative = duty saving
      const lineValue = item.totalValue instanceof Decimal
        ? item.totalValue
        : new Decimal(item.totalValue as string);
      const dutyImpact = lineValue.mul(newRate.minus(prevRate)).toDecimalPlaces(4);

      await db.classificationChangeImpact.create({
        data: {
          classificationDecisionId: decisionId,
          accountId,
          shipmentId: item.shipmentId,
          lineItemId: item.id,
          filingId: filing?.id ?? null,
          previousHtsCode: previousHtsCode ?? null,
          newHtsCode,
          dutyImpact,
        },
      });

      // F-5: create ComplianceFinding for already-filed entries
      if (filing && ["Transmitted", "Released", "Closed"].includes(filing.filingStatus)) {
        await db.complianceFinding.create({
          data: {
            accountId,
            filingId: filing.id,
            rule: "HTS_CLASSIFICATION_CHANGE",
            severity: "Warning",
            description: `HTS code changed from ${previousHtsCode ?? "unknown"} to ${newHtsCode} for a line item on this entry. Review for Post Summary Correction.`,
            recommendation: "Verify whether a Post Summary Correction (PSC) is required with CBP.",
            status: "Open",
          },
        });
      }
    }
  }
}
