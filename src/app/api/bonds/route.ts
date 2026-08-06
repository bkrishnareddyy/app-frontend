import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { BondService } from "@/modules/bonds/bond.service";
import { z } from "zod";

const createBondSchema = z.object({
  bondType: z.enum(["continuous", "single_transaction"]),
  suretyName: z.string().min(1, "suretyName is required"),
  bondNumber: z.string().min(3, "bondNumber is required"),
  bondAmount: z.number().positive("bondAmount must be positive"),
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  importerOfRecordId: z.string().optional(),
});

export async function GET(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const bonds = await BondService.listBonds(ctx!.accountId);
    return NextResponse.json({ bonds, requestId });
  } catch (error: any) {
    return buildErrorResponse(500, "INTERNAL_ERROR", error?.message || "Failed to list bonds", undefined, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest("bonds.manage");
  if (errorResponse) return errorResponse;

  // Idempotency check
  const { idempotencyKey, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx!.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, createBondSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const result = await BondService.createBond(ctx!.accountId, ctx!.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      action: "bond.create",
      entity: "Bond",
      entityId: result.bond.id,
      metadata: { bondNumber: result.bond.bondNumber, amount: result.bond.bondAmount },
    });

    const responsePayload = { bond: result.bond, metadata: result.metadata, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx!.accountId, idempotencyKey, "", 201, responsePayload);
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error: any) {
    if (error?.message?.includes("already exists")) {
      return buildErrorResponse(409, "CONFLICT", error.message, undefined, requestId);
    }
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", error?.message || "Failed to create bond", undefined, requestId);
  }
}
