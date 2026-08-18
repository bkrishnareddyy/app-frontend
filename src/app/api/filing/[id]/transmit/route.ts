import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { recordUsageEvent } from "@/lib/billing/telemetry";
import { FilingService } from "@/modules/filings/filing.service";
import { simulateAndApplyResponse } from "@/lib/canonicalMessaging/devStub";
import { runFilingValidation, type ValidatorInput } from "@/lib/filing/filingValidator";
import { deliverWebhookEvent } from "@/lib/webhooks/deliver";
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

  const filingForValidation = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      importerOfRecord: true,
      bond: true,
      shipment: {
        include: {
          lineItems: {
            include: {
              product: { include: { classifications: { where: { status: "APPROVED" } } } },
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

  const isStandalone = !filingForValidation.shipmentId || !filingForValidation.shipment;

  if (isStandalone) {
    if (!filingForValidation.localReferenceNumber) {
      return NextResponse.json({
        error: {
          code: "VALIDATION_BLOCKERS",
          message: "Transmission blocked: Local Reference Number is required for standalone filings.",
          blockers: [{ field: "localReferenceNumber", rule: "required", message: "Local Reference Number must be provided" }],
          warnings: [],
        },
        requestId,
      }, { status: 422 });
    }
  } else {
    if (!filingForValidation.shipment) {
      return buildErrorResponse(400, "BAD_REQUEST", "Shipment not found for this filing", undefined, requestId);
    }

    if (filingForValidation.preparedByUserId && filingForValidation.preparedByUserId === ctx.userId) {
      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: AuditAction.FILING_SEGREGATION_VIOLATION,
        entity: "CustomsFiling",
        entityId: id,
        source: "UI",
        metadata: { attemptedAction: "transmit", entryNumber: filingForValidation.entryNumber },
      });
      return buildErrorResponse(
        403,
        "SEGREGATION_OF_DUTIES_VIOLATION",
        "The user who prepared this filing cannot also transmit it. A different user must submit it to customs.",
        undefined,
        requestId
      );
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
      hasApprovedDecision: (li.product?.classifications?.length ?? 0) > 0,
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
      blockingReconciliationIssues: filingForValidation.shipment.reconciliationIssues.filter((r) => r.severity === "Critical").map((r) => ({ id: r.id })),
      htsReleaseAgeInDays,
      transportMode: filingForValidation.shipment.transportMode,
    };

    const outcome = runFilingValidation(validatorInput);
    if (!outcome.valid) {
      return NextResponse.json({
        error: {
          code: "VALIDATION_BLOCKERS",
          message: `Transmission blocked: ${outcome.blockers.length} validation issue(s) must be resolved before filing.`,
          blockers: outcome.blockers,
          warnings: outcome.warnings,
        },
        requestId,
      }, { status: 422 });
    }
  }

  try {
    const result = await FilingService.transmitFiling(ctx.accountId, ctx.userId, id);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.FILING_TRANSMITTED,
      entity: "CustomsFiling",
      entityId: id,
      source: "UI",
      metadata: { entryNumber: result.filing.entryNumber, messageId: result.messageId },
    });

    if (filingForValidation.shipment) {
      try {
        await recordUsageEvent({
          accountId: ctx.accountId,
          eventCode: "ACE_FILING_TRANSMITTED",
          clientId: filingForValidation.shipment.clientId ?? undefined,
          importerId: filingForValidation.shipment.importerOfRecordId ?? undefined,
          shipmentId: filingForValidation.shipment.id,
          userId: ctx.userId,
          quantity: 1,
          unit: "transmission",
          sourceFunction: "FilingService.transmitFiling",
          sourceApi: `/api/filing/${id}/transmit`,
          success: true,
          automated: false,
          idempotencyKey: `billing:ace-transmit:${idempotencyKey ?? requestId}`,
          metadata: {
            filingId: id,
            entryNumber: result.filing.entryNumber,
            messageId: result.messageId,
          },
        });
      } catch (billingError) {
        console.error("Failed to record ACE filing billing usage", billingError);
      }
    }

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

    deliverWebhookEvent(ctx.accountId, "filing.submitted", {
      filingId: id,
      entryNumber: result.filing.entryNumber,
      messageId: result.messageId,
    }).catch((err) => console.error("[webhook] Failed to dispatch filing.submitted:", err));

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
