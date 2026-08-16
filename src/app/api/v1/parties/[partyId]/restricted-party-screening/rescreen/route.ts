/**
 * POST /api/v1/parties/[partyId]/restricted-party-screening/rescreen
 *
 * Re-runs Restricted/Denied-Party Screening against a Party Master record's
 * current-effective name/address/contact (rescreenParty in
 * partyScreeningLifecycle.ts). Tenant-scoped: a partyId belonging to another
 * account is reported as not found, never forbidden. Requires
 * `compliance.restrictedParty.screen`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { rescreenParty, PartyHasNoActiveNameError } from "@/modules/agents/compliance/restrictedParty/partyScreeningLifecycle";

const paramsSchema = z.object({ partyId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ partyId: string }>(
  async ({ ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;

    const party = await db.party.findFirst({
      where: { id: paramsVal.data.partyId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!party) {
      return NextResponse.json({ error: "Party not found", requestId }, { status: 404 });
    }

    try {
      const { overallStatus, results } = await rescreenParty(ctx.accountId, party.id);

      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: AuditAction.RESTRICTED_PARTY_SCREENING_RESCREENED,
        entity: "Party",
        entityId: party.id,
        source: "UI",
        metadata: { overallStatus },
        requestId,
      });

      return NextResponse.json(
        {
          success: true,
          overallStatus,
          results: results.map((r) => ({
            id: r.id,
            passType: r.passType,
            status: r.status,
            hitCount: r.hitCount,
            redFlagCount: r.redFlagCount,
          })),
          requestId,
        },
        { status: 200 }
      );
    } catch (error) {
      if (error instanceof PartyHasNoActiveNameError) {
        return NextResponse.json({ error: error.message, requestId }, { status: 422 });
      }
      throw error;
    }
  },
  { permission: "compliance.restrictedParty.screen", write: true }
);
