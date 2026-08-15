import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { Decimal } from "@/lib/tariff/decimal";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

const updateSchema = z.object({
  groundsCode: z.string().optional(),
  groundsNarrative: z.string().optional(),
  statuteCitation: z.string().optional(),
  rulingReference: z.string().optional(),
  claimAmount: z.number().nonnegative().optional(),
  interestClaimed: z.boolean().optional(),
  powerOfAttorneyVerified: z.boolean().optional(),
  poaExpiresAt: z.string().datetime().optional(),
  entries: z
    .array(
      z.object({
        filingId: z.string(),
        entryNumber: z.string(),
        liquidationDate: z.string().datetime(),
        dutyAssessed: z.number().nonnegative(),
        dutyContested: z.number().nonnegative(),
      })
    )
    .optional(),
});

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const protest = await db.protest.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      protestEntries: {
        include: {
          filing: { select: { entryNumber: true, filingStatus: true, totalDuties: true } },
        },
      },
      Attachments: { orderBy: { uploadedAt: "desc" } },
      Notes: { orderBy: { createdAt: "asc" } },
      linkedPsc: {
        select: {
          id: true,
          status: true,
          correctionType: true,
          reason: true,
          originalDutyAmount: true,
          correctedDutyAmount: true,
        },
      },
    },
  });

  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }

  return NextResponse.json({ protest, requestId });
}, { permission: "protest.read" });

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, updateSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { entries, ...fields } = bodyVal.data;

  const protest = await db.protest.findFirst({
    where: { id, accountId: ctx.accountId },
  });
  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }
  if (!["DRAFT", "READY_FOR_FILING"].includes(protest.status)) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `Only DRAFT or READY_FOR_FILING protests can be edited. Current: ${protest.status}`,
      undefined,
      requestId
    );
  }

  const updateData: Record<string, unknown> = {};
  if (fields.groundsCode !== undefined) updateData.groundsCode = fields.groundsCode;
  if (fields.groundsNarrative !== undefined) updateData.groundsNarrative = fields.groundsNarrative;
  if (fields.statuteCitation !== undefined) updateData.statuteCitation = fields.statuteCitation;
  if (fields.rulingReference !== undefined) updateData.rulingReference = fields.rulingReference;
  if (fields.claimAmount !== undefined) updateData.claimAmount = new Decimal(fields.claimAmount);
  if (fields.interestClaimed !== undefined) updateData.interestClaimed = fields.interestClaimed;
  if (fields.powerOfAttorneyVerified !== undefined)
    updateData.powerOfAttorneyVerified = fields.powerOfAttorneyVerified;
  if (fields.poaExpiresAt !== undefined) updateData.poaExpiresAt = new Date(fields.poaExpiresAt);

  // Replace entries if provided
  if (entries !== undefined) {
    if (entries.length > 0) {
      const filingIds = [...new Set(entries.map((e) => e.filingId))];
      const ownedFilings = await db.customsFiling.findMany({
        where: { id: { in: filingIds }, accountId: ctx.accountId },
        select: { id: true },
      });
      if (ownedFilings.length !== filingIds.length) {
        return buildErrorResponse(404, "NOT_FOUND", "One or more linked filings were not found in this account", undefined, requestId);
      }
    }
    await db.protestEntry.deleteMany({ where: { protestId: id } });
    updateData.protestEntries = {
      create: entries.map((e) => ({
        filingId: e.filingId,
        entryNumber: e.entryNumber,
        liquidationDate: new Date(e.liquidationDate),
        dutyAssessed: new Decimal(e.dutyAssessed),
        dutyContested: new Decimal(e.dutyContested),
      })),
    };
  }

  const updated = await db.protest.update({
    where: { id },
    data: updateData,
    include: { protestEntries: true, Attachments: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PROTEST_STATUS_CHANGED,
    entity: "Protest",
    entityId: id,
    source: "UI",
    metadata: { updatedFields: Object.keys(updateData) },
  });

  return NextResponse.json({ protest: updated, requestId });
}, { permission: "protest.create", write: true });
