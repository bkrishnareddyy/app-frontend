import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { hasPermission } from "@/lib/auth";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
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
  expectedVersion: z.number().int({ message: "expectedVersion integer is required for concurrency control" }),
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, updateSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  // Waiving accepts the underlying risk on the account's behalf, so it needs more
  // than write access. The status has to be read before the permission is chosen.
  const requestedState = normalizeExceptionStatus(bodyVal.data.status);
  if (requestedState && isRiskAcceptance(requestedState)) {
    const allowed = await hasPermission(RISK_ACCEPTANCE_PERMISSION);
    if (!allowed) {
      return buildErrorResponse(
        403,
        "FORBIDDEN",
        `Waiving an exception accepts the risk it describes. Missing required permission: ${RISK_ACCEPTANCE_PERMISSION}`,
        undefined,
        requestId
      );
    }
  }

  try {
    const resolverName = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ") || ctx.email;
    const updated = await ExceptionService.updateException(ctx.accountId, id, bodyVal.data, {
      userId: ctx.userId,
      name: resolverName,
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "exception.update",
      entity: "ExceptionItem",
      entityId: id,
      metadata: {
        newStatus: updated.status,
        version: updated.version,
        shipmentId: updated.shipmentId,
      },
    });

    return NextResponse.json({ exception: updated, requestId });
  } catch (error: unknown) {
    if (errorMessage(error) === "NOT_FOUND") {
      return buildErrorResponse(404, "NOT_FOUND", "Exception item not found", undefined, requestId);
    }
    if (errorMessage(error) === "SHIPMENT_NOT_FOUND") {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment not found in this account", undefined, requestId);
    }
    if (errorMessage(error) === "STALE_VERSION") {
      return buildErrorResponse(409, "CONFLICT", "Stale update detected. Exception item has been modified by another user.", undefined, requestId);
    }
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to update exception item", undefined, requestId);
  }
}, { write: true });
