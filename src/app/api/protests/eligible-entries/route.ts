import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { z } from "zod";

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
});

/**
 * GET /api/protests/eligible-entries
 * Returns liquidated filings that can be added to a protest:
 * - filingStatus is "Released" or "Closed" (indicating liquidation has occurred)
 * - Not already covered by an active (non-WITHDRAWN) protest
 * - Protest window (180 days from liquidation) has not yet expired
 */
export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") });
  const limit = parsed.success ? parsed.data.limit : 50;

  // 180 days ago — entries liquidated before this cannot be protested
  const windowCutoff = new Date();
  windowCutoff.setDate(windowCutoff.getDate() - 180);

  const filings = await db.customsFiling.findMany({
    where: {
      accountId: ctx.accountId,
      filingStatus: { in: ["Released", "Closed"] },
      releasedAt: { gte: windowCutoff },
    },
    include: {
      shipment: { select: { shipmentNumber: true } },
      importerOfRecord: { select: { name: true } },
    },
    orderBy: { releasedAt: "desc" },
    take: limit,
  });

  // Filter out entries already covered by an active protest
  const activeProtestEntries = await db.protestEntry.findMany({
    where: {
      protest: { accountId: ctx.accountId, status: { not: "WITHDRAWN" } },
      filingId: { in: filings.map((f) => f.id) },
    },
    select: { filingId: true },
  });
  const coveredFilingIds = new Set(activeProtestEntries.map((e) => e.filingId));

  const eligible = filings
    .filter((f) => !coveredFilingIds.has(f.id))
    .map((f) => {
      const liquidationDate = f.releasedAt ?? new Date();
      const protestDeadline = new Date(liquidationDate);
      protestDeadline.setDate(protestDeadline.getDate() + 180);
      const daysRemaining = Math.max(
        0,
        Math.floor((protestDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      );
      return {
        id: f.id,
        entryNumber: f.entryNumber,
        shipmentNumber: f.shipment.shipmentNumber,
        importerName: f.importerOfRecord?.name ?? null,
        filingStatus: f.filingStatus,
        totalDuties: f.totalDuties,
        liquidationDate: liquidationDate.toISOString(),
        protestDeadline: protestDeadline.toISOString(),
        daysRemaining,
        urgent: daysRemaining <= 30,
      };
    });

  return NextResponse.json({ eligible, total: eligible.length, requestId });
}, { permission: "protest.read" });
