import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { parsePagination } from "@/lib/api/pagination";

export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const severity = searchParams.get("severity");
  const { limit, cursor } = parsePagination(searchParams);

  const where: import("@prisma/client").Prisma.ComplianceFindingWhereInput = { accountId: ctx.accountId };

  if (status && status !== "all") {
    where.status = { equals: status, mode: "insensitive" };
  }
  if (severity) {
    where.severity = { equals: severity, mode: "insensitive" };
  }
  if (cursor) {
    where.id = { lt: cursor };
  }

  // This GET used to attach two invented findings to a real customs filing --
  // a 24% valuation variance and an undeclared tooling assist, with confidences
  // of 94 and 88 -- and assign them to the caller. They were allegations against
  // an entry that no rule had ever evaluated.
  const [findings, total] = await Promise.all([
    db.complianceFinding.findMany({
      where,
      include: {
        filing: { include: { shipment: true } },
        assignedToUser: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.complianceFinding.count({ where: { accountId: ctx.accountId } }),
  ]);

  const nextCursor = findings.length === limit ? (findings[findings.length - 1]?.id ?? null) : null;

  return NextResponse.json({ findings, pagination: { nextCursor, hasMore: nextCursor !== null, total }, requestId });
});
