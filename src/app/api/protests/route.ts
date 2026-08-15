import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { Decimal } from "@/lib/tariff/decimal";
import { z } from "zod";

const GroundsCodeEnum = z.enum([
  "CLASSIFICATION",
  "VALUATION",
  "ORIGIN",
  "RATE_OF_DUTY",
  "LIQUIDATION_ERRORS",
  "EXCLUSION_ELIGIBILITY",
  "DRAWBACK_DENIAL",
  "OTHER",
]);

const createProtestSchema = z.object({
  liquidationDate: z.string().datetime({ message: "liquidationDate must be an ISO 8601 datetime" }),
  groundsCode: GroundsCodeEnum,
  groundsNarrative: z.string().min(1, "Grounds narrative is required"),
  statuteCitation: z.string().optional(),
  rulingReference: z.string().optional(),
  claimAmount: z.number().nonnegative(),
  interestClaimed: z.boolean().default(false),
  linkedPscId: z.string().optional(),
  notes: z.string().optional(),
  // Initial entries (optional — can be added later via PATCH)
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

const listQuerySchema = z.object({
  status: z.string().optional(),
  groundsCode: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const url = new URL(req.url);
  const query = listQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    groundsCode: url.searchParams.get("groundsCode") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  const where: Record<string, unknown> = { accountId: ctx.accountId };
  if (query.success) {
    if (query.data.status) where.status = query.data.status;
    if (query.data.groundsCode) where.groundsCode = query.data.groundsCode;
    if (query.data.from || query.data.to) {
      where.protestDeadline = {
        ...(query.data.from ? { gte: new Date(query.data.from) } : {}),
        ...(query.data.to ? { lte: new Date(query.data.to) } : {}),
      };
    }
  }

  const protests = await db.protest.findMany({
    where,
    include: {
      protestEntries: true,
      Attachments: { orderBy: { uploadedAt: "desc" } },
      Notes: { orderBy: { createdAt: "desc" }, take: 5 },
      linkedPsc: { select: { id: true, status: true, correctionType: true } },
    },
    orderBy: { protestDeadline: "asc" },
  });

  return NextResponse.json({ protests, requestId });
}, { permission: "protest.read" });

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createProtestSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  const {
    liquidationDate,
    groundsCode,
    groundsNarrative,
    statuteCitation,
    rulingReference,
    claimAmount,
    interestClaimed,
    linkedPscId,
    entries,
  } = bodyVal.data;

  const liquidationDateObj = new Date(liquidationDate);

  // Protest deadline = liquidation date + 180 calendar days
  const protestDeadline = new Date(liquidationDateObj);
  protestDeadline.setDate(protestDeadline.getDate() + 180);

  // Validate window is not already expired
  if (protestDeadline < new Date()) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "The 180-day protest window has already expired for this liquidation date.",
      undefined,
      requestId
    );
  }

  if (linkedPscId) {
    const psc = await db.postSummaryCorrection.findFirst({
      where: { id: linkedPscId, accountId: ctx.accountId },
    });
    if (!psc) {
      return buildErrorResponse(404, "NOT_FOUND", "Linked PSC not found", undefined, requestId);
    }
  }

  if (entries && entries.length > 0) {
    const filingIds = [...new Set(entries.map((e) => e.filingId))];
    const ownedFilings = await db.customsFiling.findMany({
      where: { id: { in: filingIds }, accountId: ctx.accountId },
      select: { id: true },
    });
    if (ownedFilings.length !== filingIds.length) {
      return buildErrorResponse(404, "NOT_FOUND", "One or more linked filings were not found in this account", undefined, requestId);
    }
  }

  const protest = await db.protest.create({
    data: {
      accountId: ctx.accountId,
      liquidationDate: liquidationDateObj,
      protestDeadline,
      groundsCode,
      groundsNarrative,
      statuteCitation: statuteCitation ?? null,
      rulingReference: rulingReference ?? null,
      claimAmount: new Decimal(claimAmount),
      interestClaimed,
      linkedPscId: linkedPscId ?? null,
      status: "DRAFT",
      createdByUserId: ctx.userId,
      protestEntries: entries
        ? {
            create: entries.map((e) => ({
              filingId: e.filingId,
              entryNumber: e.entryNumber,
              liquidationDate: new Date(e.liquidationDate),
              dutyAssessed: new Decimal(e.dutyAssessed),
              dutyContested: new Decimal(e.dutyContested),
            })),
          }
        : undefined,
    },
    include: {
      protestEntries: true,
      Attachments: true,
      Notes: true,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PROTEST_CREATED,
    entity: "Protest",
    entityId: protest.id,
    source: "UI",
    metadata: { groundsCode, claimAmount, protestDeadline: protestDeadline.toISOString() },
  });

  return NextResponse.json({ protest, requestId }, { status: 201 });
}, { permission: "protest.create", write: true });
