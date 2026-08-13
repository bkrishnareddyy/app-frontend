import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { FilingService } from "@/modules/filings/filing.service";
import { simulateAndApplyResponse } from "@/lib/canonicalMessaging/devStub";
import { runFilingValidation, type ValidatorInput } from "@/lib/filing/filingValidator";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

const DEFAULT_READINESS_THRESHOLD = 80;

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  // ── Server-side filing validation gate (Task B-3) ──────────────────────────
  // The client cannot bypass this check — it runs unconditionally on every
  // transmit attempt, regardless of what the client reports about validation state.

  const filingForValidation = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      importerOfRecord: true,
      bond: true,
      shipment: {
        include: {
          lineItems: {
            include: {
              product: { include: { productClassifications: { where: { status: "APPROVED" } } } },
            },
          },
          exceptionItems: { where: { status: "Open", blocking: true } },
          reconciliationIssues: { where: { status: "Open" } },
        },
      },
    },
  });

  if (!filingForValidation) {
    return buildErrorResponse(404, "NOT_FOUND", "Filing case not found", undefined, requestId);
  }

  const policyConfig = await db.agentPolicyConfig.findFirst({
    where: { accountId: ctx.accountId, agentName: "FilingReadinessAgent" },
    select: { autoThreshold: true },
  });
  const readinessThreshold = policyConfig?.autoThreshold ?? DEFAULT_READINESS_THRESHOLD;

  const publishedRelease = await db.htsRelease.findFirst({
    where: { country: "US", publicationStatus: "PUBLISHED" },
    orderBy: { effectiveFrom: "desc" },
    select: { effectiveFrom: true },
  });
  const htsReleaseAgeInDays = publishedRelease?.effectiveFrom
    ? Math.floor((Date.now() - publishedRelease.effectiveFrom.getTime()) / 86_400_000)
    : null;

  const lineItemsForValidation: ValidatorInput["lineItems"] = filingForValidation.shipment.lineItems.map((li) => ({
    id: li.id,
    lineNumber: li.lineNumber,
    htsCode: li.htsCode,
    hasApprovedDecision: (li.product?.productClassifications?.length ?? 0) > 0,
  }));

  const validatorInput: ValidatorInput = {
    filingId: id,
    entryType: filingForValidation.entryType,
    portOfEntry: filingForValidation.shipment.portOfEntry,
    importerOfRecordId: filingForValidation.importerOfRecordId ?? null,
    importerCbpNumber: filingForValidation.importerOfRecord?.cbpImporterNumber ?? null,
    readinessScore: filingForValidation.shipment.readinessScore,
    readinessThreshold,
    bondExpirationDate: filingForValidation.bond?.expirationDate ?? null,
    bondAmount: filingForValidation.bond?.bondAmount ? Number(filingForValidation.bond.bondAmount) : null,
    estimatedTotalDuties: filingForValidation.totalDuties ? Number(filingForValidation.totalDuties) : null,
    lineItems: lineItemsForValidation,
    blockingExceptions: filingForValidation.shipment.exceptionItems.map((e) => ({ id: e.id })),
    blockingReconciliationIssues: filingForValidation.shipment.reconciliationIssues
      .filter((r) => r.severity === "Critical")
      .map((r) => ({ id: r.id })),
    htsReleaseAgeInDays,
    transportMode: filingForValidation.shipment.transportMode,
  };

  const outcome = runFilingValidation(validatorInput);

  if (!outcome.valid) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_BLOCKERS",
          message: `Transmission blocked: ${outcome.blockers.length} validation issue(s) must be resolved before filing.`,
          blockers: outcome.blockers,
          warnings: outcome.warnings,
        },
        requestId,
      },
      { status: 422 }
    );
  }

  // ── Proceed to transmission ────────────────────────────────────────────────

  try {
    const result = await FilingService.transmitFiling(ctx.accountId, ctx.userId, id);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "filing.transmit",
      entity: "CustomsFiling",
      entityId: id,
      metadata: { entryNumber: result.filing.entryNumber, messageId: result.messageId },
    });

    // No real third party exists yet, so there is no other process that will
    // ever answer the outbound message we just published. In production,
    // with a real integration wired up, this same message would sit PENDING
    // until they respond -- CUSTOMS_FILING_MOCK_RESPONSES=false restores that
    // behaviour. A simulation failure must never fail the transmit itself:
    // the real outbound message is already durably published at this point.
    let mockResponseApplied = false;
    try {
      mockResponseApplied = await simulateAndApplyResponse(result.messageId);
    } catch (err) {
      console.warn(`[transmit] dev-stub response simulation failed for filing ${id}:`, err);
    }

    const latestFiling = mockResponseApplied
      ? await db.customsFiling.findUnique({ where: { id } })
      : null;

    const responsePayload = {
      transmission: {
        status: latestFiling?.filingStatus ?? result.filing.filingStatus,
        entryNumber: result.filing.entryNumber,
        transmittedAt: result.filing.submittedAt,
        messageId: result.messageId,
        mockResponseApplied,
      },
      requestId,
    };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    if (errorMessage(error) === "NOT_FOUND") {
      return buildErrorResponse(404, "NOT_FOUND", "Filing case not found", undefined, requestId);
    }
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to transmit filing", undefined, requestId);
  }
}, { permission: "filings.submit", write: true });
