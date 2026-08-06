import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId , errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { ExceptionService } from "@/modules/exceptions/exception.service";
import { z } from "zod";

const updateSchema = z.object({
  status: z.string().optional(),
  assignedToUserId: z.string().optional(),
  resolutionReason: z.string().optional(),
  resolutionEvidence: z.string().optional(),
  expectedVersion: z.number().int({ message: "expectedVersion integer is required for concurrency control" }),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  const { id } = await context.params;
  const bodyVal = await parseAndValidateBody(req, updateSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const updated = await ExceptionService.updateException(ctx!.accountId, id, bodyVal.data);

    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      action: "exception.update",
      entity: "ExceptionItem",
      entityId: id,
      metadata: { newStatus: updated.status, version: updated.version },
    });

    return NextResponse.json({ exception: updated, requestId });
  } catch (error: unknown) {
    if (errorMessage(error) === "NOT_FOUND") {
      return buildErrorResponse(404, "NOT_FOUND", "Exception item not found", undefined, requestId);
    }
    if (errorMessage(error) === "STALE_VERSION") {
      return buildErrorResponse(409, "CONFLICT", "Stale update detected. Exception item has been modified by another user.", undefined, requestId);
    }
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to update exception item", undefined, requestId);
  }
}
