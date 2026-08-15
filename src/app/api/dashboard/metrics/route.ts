import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { computeAnalyticsMetrics } from "@/lib/analytics/metricComputer";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "MONTHLY";
  const clientId = searchParams.get("clientId") ?? undefined;

  // For client-scoped requests, verify the client belongs to this account.
  if (clientId) {
    const client = await db.client.findFirst({ where: { id: clientId, accountId: ctx.accountId } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
  }

  // Live metrics — scoped by clientId when provided.
  const live = await computeAnalyticsMetrics(ctx.accountId, clientId);

  // Cached snapshots are account-wide; client-level breakdown uses live metrics only.
  const snapshots = clientId
    ? []
    : await db.workMetricSnapshot.findMany({
        where: { accountId: ctx.accountId, period },
        orderBy: { date: "asc" },
        take: 6,
      });

  const emptyState =
    snapshots.length === 0 &&
    live.filedEntries === 0 &&
    live.openExceptions === 0;

  return NextResponse.json({
    live,
    snapshots: snapshots.map((s) => ({
      date: s.date.toISOString().split("T")[0],
      cyclTimeMedianHours: s.cyclTimeMedianHours,
      firstPassRate: s.firstPassRate,
      touchRate: s.touchRate,
      dutyPerEntry: s.dutyPerEntry !== null ? Number(s.dutyPerEntry) : null,
      openExceptions: s.openExceptions,
      filedEntries: s.filedEntries,
    })),
    emptyState,
    clientId: clientId ?? null,
  });
});
