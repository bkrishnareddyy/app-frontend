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
    return buildErrorResponse({ message: "Filing not found", code: "NOT_FOUND" }, 404, requestId);
  }

  // Declaration data is stored in dutyBreakdown as a temporary solution
  // In production, you might want a dedicated declarationData JSON field
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
    return buildErrorResponse({ message: "declarationData is required", code: "INVALID_INPUT" }, 400, requestId);
  }

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, dutyBreakdown: true, entryNumber: true, country: true, transactionType: true },
  });

  if (!filing) {
    return buildErrorResponse({ message: "Filing not found", code: "NOT_FOUND" }, 404, requestId);
  }

  // Wrap the declaration data with proper Import/ExportDeclaration wrapper
  const wrappedDeclaration = wrapDeclarationData(
    body.declarationData,
    filing.transactionType || 'IMPORT',
    filing.country || 'US'
  );

  // Store declaration data in dutyBreakdown with a special key
  // This is a temporary solution - in production, consider adding a dedicated field
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
    action: AuditAction.UPDATE,
    entity: "CustomsFiling",
    entityId: filing.id,
    metadata: {
      description: `Saved declaration draft for filing ${filing.entryNumber}`,
      fields: ['declarationData'],
    },
  });

  return NextResponse.json({ success: true });
});
