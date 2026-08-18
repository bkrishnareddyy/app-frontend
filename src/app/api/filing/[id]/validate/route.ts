import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { applyTransition, canTransition } from "@/modules/filings/filingStateMachine";
import { runFilingValidation, type ValidatorInput } from "@/lib/filing/filingValidator";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

const DEFAULT_READINESS_THRESHOLD = 80;

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      importerOfRecord: true,
      bond: true,
      shipment: {
        include: {
          documents: true,
          lineItems: { include: { product: { include: { classifications: { where: { status: "APPROVED" } } } } } },
          exceptionItems: { where: { status: "Open", blocking: true } },
          reconciliationIssues: { where: { status: "Open" } },
        },
      },
    },
});

  if (!filing) {
    return NextResponse.json({ error: "Filing not found" }, { status: 404 });
  }

  // Check if this is a standalone filing (no shipment)
  const isStandalone = !filing.shipmentId || !filing.shipment;
  
  if (isStandalone) {
    // For standalone filings, validation is minimal for now
    // TODO: Implement standalone filing validation based on declarationData
    
    // Transition status: Draft -> ReadyForBrokerReview
    let newStatus = filing.filingStatus;
    if (filing.filingStatus === "Draft") {
      newStatus = "ReadyForBrokerReview";
      await db.customsFiling.update({
        where: { id: filing.id },
        data: { filingStatus: newStatus },
      });
    }
    
    return NextResponse.json({
      validation: {
        filingId: filing.id,
        valid: true,
        blockers: [],
        warnings: [{
          field: "declaration",
          rule: "standalone-validation",
          message: "Standalone filing validation is not fully implemented yet. Manual review recommended."
        }],
        previousFilingStatus: filing.filingStatus,
        filingStatus: newStatus,
      },
    });
  }

  // Shipment-based filing validation (existing logic)
  if (!filing.shipment) {
    return NextResponse.json({ error: "Shipment not found for this filing" }, { status: 400 });
  }

  // Fetch readiness threshold from AgentPolicyConfig (falls back to 80)
  const policyConfig = await db.agentPolicyConfig.findFirst({
    where: { accountId: ctx.accountId, agentName: "FilingReadinessAgent" },
    select: { autoThreshold: true },
  });
  const readinessThreshold = policyConfig?.autoThreshold ?? DEFAULT_READINESS_THRESHOLD;

  // HTS release freshness
  const publishedRelease = await db.htsRelease.findFirst({
    where: { country: "US", publicationStatus: "PUBLISHED" },
    orderBy: { effectiveFrom: "desc" },
    select: { effectiveFrom: true },
  });
  const htsReleaseAgeInDays = publishedRelease?.effectiveFrom
    ? Math.floor((Date.now() - publishedRelease.effectiveFrom.getTime()) / 86_400_000)
    : null;

  const lineItems: ValidatorInput["lineItems"] = filing.shipment.lineItems.map((li) => ({
    id: li.id,
    lineNumber: li.lineNumber,
    htsCode: li.htsCode,
    hasApprovedDecision: (li.product?.classifications?.length ?? 0) > 0,
  }));

  const validatorInput: ValidatorInput = {
    filingId: filing.id,
    entryType: filing.entryType,
    portOfEntry: filing.shipment.portOfEntry,
    importerOfRecordId: filing.importerOfRecordId ?? null,
    importerCbpNumber: filing.importerOfRecord?.cbpImporterNumber ?? null,
    readinessScore: filing.shipment.readinessScore,
    readinessThreshold,
    bondExpirationDate: filing.bond?.expirationDate ?? null,
    bondAmount: filing.bond?.bondAmount ? Number(filing.bond.bondAmount) : null,
    estimatedTotalDuties: filing.totalDuties ? Number(filing.totalDuties) : null,
    lineItems,
    blockingExceptions: filing.shipment.exceptionItems.map((e) => ({ id: e.id })),
    blockingReconciliationIssues: filing.shipment.reconciliationIssues
      .filter((r) => r.severity === "Critical")
      .map((r) => ({ id: r.id })),
    htsReleaseAgeInDays,
    transportMode: filing.shipment.transportMode,
  };

  const outcome = runFilingValidation(validatorInput);

  // Advance filing status through the state machine when legal
  const transition = outcome.valid ? "validate.pass" : "validate.fail";
  let newStatus: string | null = null;
  if (canTransition(filing.filingStatus, transition)) {
    newStatus = applyTransition(filing.filingStatus, transition);
    await db.customsFiling.update({
      where: { id: filing.id },
      data: { filingStatus: newStatus },
    });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.FILING_VALIDATED,
    entity: "CustomsFiling",
    entityId: filing.id,
    source: "UI",
    metadata: {
      valid: outcome.valid,
      blockerCount: outcome.blockers.length,
      warningCount: outcome.warnings.length,
      previousStatus: filing.filingStatus,
      newStatus,
    },
  });

  return NextResponse.json({
    validation: {
      filingId: filing.id,
      valid: outcome.valid,
      blockers: outcome.blockers,
      warnings: outcome.warnings,
      previousFilingStatus: filing.filingStatus,
      filingStatus: newStatus ?? filing.filingStatus,
    },
  });

}, { permission: "filings.create", write: true });
