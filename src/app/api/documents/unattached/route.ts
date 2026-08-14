import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

const PAGE_SIZE = 25;

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? undefined;

  const documents = await db.shipmentDocument.findMany({
    where: {
      accountId: ctx.accountId,
      shipmentId: null,
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    include: {
      // E-2: Surface candidates so the UI can offer one-click attach.
      shipmentCandidates: {
        include: { shipment: { select: { id: true, shipmentNumber: true, portOfEntry: true } } },
        orderBy: { confidenceScore: "desc" },
        take: 3,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: PAGE_SIZE,
  });

  const nextCursor = documents.length === PAGE_SIZE ? (documents[documents.length - 1]?.id ?? null) : null;

  return NextResponse.json({
    documents,
    pagination: { nextCursor, hasMore: nextCursor !== null },
  });
});
