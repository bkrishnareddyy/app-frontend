/**
 * GET /api/v1/parties/[partyId]/restricted-party-screening-history
 *
 * Reads a Party Master record's screening summary plus its full immutable
 * screening history, tenant-scoped. A partyId belonging to another account
 * is reported as not found, never forbidden -- the same enumeration-oracle
 * rule documented in partyService.ts. Requires `compliance.restrictedParty.read`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";

const paramsSchema = z.object({ partyId: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ partyId: string }>(
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

    const [summary, results] = await Promise.all([
      db.partyScreeningSummary.findUnique({ where: { partyId: party.id } }),
      db.restrictedPartyScreeningResult.findMany({
        where: { partyId: party.id, accountId: ctx.accountId },
        include: { matches: true, redFlagHits: true, disposition: true },
        orderBy: { screeningDate: "desc" },
        take: 50,
      }),
    ]);

    return NextResponse.json({ success: true, summary, results, requestId }, { status: 200 });
  },
  { permission: "compliance.restrictedParty.read" }
);
