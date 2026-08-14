import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * POST /api/protests/[id]/file
 * Transition READY_FOR_FILING → FILED with full pre-flight validation.
 */
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const protest = await db.protest.findFirst({
    where: { id, accountId: ctx.accountId },
    include: { protestEntries: true },
  });

  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }
  if (protest.status !== "READY_FOR_FILING") {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `Protest must be in READY_FOR_FILING status to file. Current: ${protest.status}`,
      undefined,
      requestId
    );
  }

  // Pre-flight checks
  if (protest.protestEntries.length === 0) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "At least one entry must be added to the protest before filing.",
      undefined,
      requestId
    );
  }
  if (protest.groundsNarrative.length < 100) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "Grounds narrative must be at least 100 characters to constitute a valid legal basis.",
      undefined,
      requestId
    );
  }
  if (!protest.powerOfAttorneyVerified) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "Power of Attorney must be verified before filing a protest on behalf of an importer.",
      undefined,
      requestId
    );
  }
  if (protest.poaExpiresAt && protest.poaExpiresAt < new Date()) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "The Power of Attorney on file has expired. Please renew before filing.",
      undefined,
      requestId
    );
  }
  if (protest.protestDeadline < new Date()) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "The 180-day protest window has expired. This protest can no longer be filed with CBP.",
      undefined,
      requestId
    );
  }

  // Deemed-denial date = filed date + 2 years
  const filedAt = new Date();
  const deemedDeniedAt = new Date(filedAt);
  deemedDeniedAt.setFullYear(deemedDeniedAt.getFullYear() + 2);

  const updated = await db.protest.update({
    where: { id },
    data: {
      status: "FILED",
      filedAt,
      deemedDeniedAt,
    },
    include: { protestEntries: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PROTEST_FILED,
    entity: "Protest",
    entityId: id,
    source: "UI",
    metadata: {
      groundsCode: protest.groundsCode,
      claimAmount: Number(protest.claimAmount),
      entriesCount: protest.protestEntries.length,
      deemedDeniedAt: deemedDeniedAt.toISOString(),
    },
  });

  // Notify account members
  const members = await db.accountMembership.findMany({
    where: { accountId: ctx.accountId },
    select: { userId: true },
  });
  await db.notification.createMany({
    data: members.map((m: { userId: string }) => ({
      accountId: ctx.accountId,
      userId: m.userId,
      type: "PROTEST_FILED",
      message: `Protest ${id} has been filed with CBP. Deemed-denial date: ${deemedDeniedAt.toLocaleDateString()}.`,
      entityType: "Protest",
      entityId: id,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ protest: updated, requestId });
}, { permission: "protest.manage", write: true });
