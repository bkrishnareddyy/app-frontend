import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { recordUsageEvent } from "@/lib/billing/telemetry";
import { ExceptionService } from "@/modules/exceptions/exception.service";
import {
  RISK_ACCEPTANCE_PERMISSION,
  isRiskAcceptance,
  normalizeExceptionStatus,
} from "@/modules/exceptions/exceptionState";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

const updateSchema = z.object({
  status: z.string().optional(),
  assignedToUserId: z.string().optional(),
  shipmentId: z.string().min(1).nullable().optional(),
  resolutionReason: z.string().optional(),
  resolutionReasonCode: z.string().optional(),
  source: z.string().optional(),
  expectedVersion: z.number().int({ message: "expectedVersion integer is required for concurrency control" }),
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, updateSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  const requestedState = normalizeExceptionStatus(bodyVal.data.status);
  if (requestedState && isRiskAcceptance(requestedState)) {
    const allowed = await hasPermission(RISK_ACCEPTANCE_PERMISSION);
    if (!allowed) {
      return buildErrorResponse(403, "FORBIDDEN", `Waiving an exception accepts the risk it describes. Missing required permission: ${RISK_ACCEPTANCE_PERMISSION}`, undefined, requestId);
    }
  }

  try {
    const resolverName = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email;
    const updated = await ExceptionService.updateException(ctx.accountId, id, bodyVal.data, {
      userId: ctx.userId,
      name: resolverName,
    });

    const auditSource = (req.headers?.get?.("x-qubere-source") === "CHAT" || bodyVal.data.source === "CHAT") ? "CHAT" : "UI";

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "exception.update",
      entity: "ExceptionItem",
      entityId: id,
      source: auditSource,
      metadata: { newStatus: updated.status, version: updated.version, shipmentId: updated.shipmentId },
    });

    if (requestedState === "RESOLVED" && updated.shipmentId) {
      try {
        const shipment = await db.shipment.findFirst({
          where: { id: updated.shipmentId, accountId: ctx.accountId },
          select: { id: true, clientId: true, importerOfRecordId: true },
        });
        if (shipment) {
          await recordUsageEvent({
            accountId: ctx.accountId,
            eventCode: "EXCEPTION_MANUALLY_RESOLVED",
            clientId: shipment.clientId ?? undefined,
            importerId: shipment.importerOfRecordId ?? undefined,
            shipmentId: shipment.id,
            userId: ctx.userId,
            quantity: 1,
            unit: "exception",
            sourceFunction: "ExceptionService.updateException",
            sourceApi: `/api/exceptions/${id}`,
            success: true,
            automated: false,
            idempotencyKey: `billing:exception-resolved:${id}`,
            metadata: {
              exceptionId: id,
              resolutionReason: bodyVal.data.resolutionReason,
              resolutionReasonCode: bodyVal.data.resolutionReasonCode,
            },
          });
        }
      } catch (billingError) {
        console.error("Failed to record exception-resolution billing usage", billingError);
      }
    }

    return NextResponse.json({ exception: updated, requestId });
  } catch (error: unknown) {
    if (errorMessage(error) === "NOT_FOUND") return buildErrorResponse(404, "NOT_FOUND", "Exception item not found", undefined, requestId);
    if (errorMessage(error) === "SHIPMENT_NOT_FOUND") return buildErrorResponse(404, "NOT_FOUND", "Shipment not found in this account", undefined, requestId);
    if (errorMessage(error) === "STALE_VERSION") return buildErrorResponse(409, "CONFLICT", "Stale update detected. Exception item has been modified by another user.", undefined, requestId);
    const msg = errorMessage(error);
    if (msg.includes("required to move") || msg.includes("requires a reason code") || msg.includes("not valid for category") || msg.includes("is a risk acceptance")) {
      return buildErrorResponse(422, "UNPROCESSABLE_ENTITY", msg, undefined, requestId);
    }
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", msg || "Failed to update exception item", undefined, requestId);
  }
}, { permission: "exceptions.resolve", write: true });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ requestId, params, ctx }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const exception = await db.exceptionItem.findFirst({
    where: { id, accountId: ctx.accountId },
    include: { assignedToUser: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });

  if (!exception) return buildErrorResponse(404, "NOT_FOUND", "Exception item not found", undefined, requestId);
  return NextResponse.json({ exception, requestId });
});
