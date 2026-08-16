/**
 * GET /api/v1/screening/restricted-party/[screeningId]
 *
 * Reads one persisted, immutable Restricted/Denied-Party Screening result by
 * id, tenant-scoped. A screeningId belonging to another account is reported
 * as not found, never forbidden -- same enumeration-oracle rule documented
 * in partyService.ts. Requires `compliance.restrictedParty.read`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";

const paramsSchema = z.object({ screeningId: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ screeningId: string }>(
  async ({ ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;

    const result = await db.restrictedPartyScreeningResult.findFirst({
      where: { id: paramsVal.data.screeningId, accountId: ctx.accountId },
      include: { matches: true, redFlagHits: true, disposition: true },
    });

    if (!result) {
      return NextResponse.json({ error: "Screening result not found", requestId }, { status: 404 });
    }

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.RESTRICTED_PARTY_SCREENING_QUERIED,
      entity: "RestrictedPartyScreeningResult",
      entityId: result.id,
      source: "API",
      metadata: { screeningId: result.id },
      requestId,
    });

    return NextResponse.json({ success: true, result, requestId }, { status: 200 });
  },
  { permission: "compliance.restrictedParty.read" }
);
