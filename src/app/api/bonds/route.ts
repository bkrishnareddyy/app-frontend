import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
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

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const bonds = await BondService.listBonds(ctx.accountId);
  return NextResponse.json({ bonds, requestId });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  // Idempotency check
  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, createBondSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const result = await BondService.createBond(ctx.accountId, ctx.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "bond.create",
      entity: "Bond",
      entityId: result.bond.id,
      metadata: { bondNumber: result.bond.bondNumber, amount: result.bond.bondAmount },
    });

    const responsePayload = { bond: result.bond, metadata: result.metadata, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 201, responsePayload);
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error: unknown) {
    if (errorMessage(error)?.includes("already exists")) {
      return buildErrorResponse(409, "CONFLICT", errorMessage(error), undefined, requestId);
    }
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to create bond", undefined, requestId);
  }
}, { permission: "bonds.manage", write: true });
