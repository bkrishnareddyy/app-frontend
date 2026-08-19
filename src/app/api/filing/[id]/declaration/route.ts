import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { wrapDeclarationData } from "@/lib/canonicalMessaging/declarationBuilder";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

// GET - Retrieve declaration draft data
export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, dutyBreakdown: true },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Filing not found", undefined, requestId);
  }

  // Declaration data is stored in dutyBreakdown as a temporary solution
  let declarationData = (filing.dutyBreakdown as any)?.declarationDraft || null;
  
  // Unwrap Import/ExportDeclaration for client consumption
  if (declarationData) {
    if (declarationData.ImportDeclaration) {
      declarationData = declarationData.ImportDeclaration;
    } else if (declarationData.ExportDeclaration) {
      declarationData = declarationData.ExportDeclaration;
    }
  }

  return NextResponse.json({ declarationData });
});

// PATCH - Save declaration draft data
export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json().catch(() => null);
  if (!body || !body.declarationData) {
    return buildErrorResponse(400, "INVALID_INPUT", "declarationData is required", undefined, requestId);
  }

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, dutyBreakdown: true, entryNumber: true, country: true, procedureCode: true },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Filing not found", undefined, requestId);
  }

  // procedureCode now contains transaction type (IMPORT, EXPORT, etc.)
  const txType = filing.procedureCode || "IMPORT";

  // Wrap the declaration data with proper Import/ExportDeclaration wrapper
  const wrappedDeclaration = wrapDeclarationData(
    body.declarationData,
    txType
  );

  const existingDutyData = (filing.dutyBreakdown as any) || {};
  const updatedDutyBreakdown = {
    ...existingDutyData,
    declarationDraft: wrappedDeclaration,
  };

  await db.customsFiling.update({
    where: { id },
    data: {
      dutyBreakdown: updatedDutyBreakdown as any,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.FILING_UPDATED,
    entity: "CustomsFiling",
    entityId: filing.id,
    metadata: {
      description: `Saved declaration draft for filing ${filing.entryNumber}`,
      fields: ["declarationData"],
    },
  });

  return NextResponse.json({ success: true, declarationData: wrappedDeclaration });
});
