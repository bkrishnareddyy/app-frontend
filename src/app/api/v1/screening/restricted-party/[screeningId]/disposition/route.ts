/**
 * PATCH /api/v1/screening/restricted-party/[screeningId]/disposition
 *
 * Records the human reviewer's judgment on a screening result -- a separate,
 * mutable layer from the immutable RestrictedPartyScreeningResult itself. A
 * result that was HIT stays HIT in history even after being dispositioned
 * FALSE_POSITIVE. Requires `compliance.restrictedParty.dispose` (admin-only).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams, parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";

const paramsSchema = z.object({ screeningId: z.string().min(1) });

const bodySchema = z.object({
  status: z.enum(["CONFIRMED_MATCH", "FALSE_POSITIVE", "APPROVED", "BLOCKED", "REQUEST_MORE_INFORMATION"]),
  notes: z.string().optional(),
});

export const PATCH = withAuthenticatedRoute<{ screeningId: string }>(
  async ({ ctx, req, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;

    const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
    if ("response" in bodyVal) return bodyVal.response;

    const result = await db.restrictedPartyScreeningResult.findFirst({
      where: { id: paramsVal.data.screeningId, accountId: ctx.accountId },
      include: { disposition: true },
    });

    if (!result) {
      return NextResponse.json({ error: "Screening result not found", requestId }, { status: 404 });
    }

    const { status, notes } = bodyVal.data;

    const disposition = result.disposition
      ? await db.restrictedPartyDisposition.update({
          where: { id: result.disposition.id },
          data: { status, notes, reviewedByUserId: ctx.userId, reviewedAt: new Date() },
        })
      : await db.restrictedPartyDisposition.create({
          data: {
            resultId: result.id,
            accountId: ctx.accountId,
            status,
            notes,
            reviewedByUserId: ctx.userId,
            reviewedAt: new Date(),
          },
        });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.RESTRICTED_PARTY_DISPOSITION_UPDATED,
      entity: "RestrictedPartyDisposition",
      entityId: disposition.id,
      source: "UI",
      metadata: { screeningId: result.id, status },
      requestId,
    });

    return NextResponse.json({ success: true, disposition, requestId }, { status: 200 });
  },
  { permission: "compliance.restrictedParty.dispose", write: true }
);
