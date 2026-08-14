import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { loadWorkQueueForAccount } from "@/modules/work/workQueueLoader";
import { buildWorkQueue, filterWorkQueue, parseWorkFilter } from "@/modules/work/workQueue";

// GET /api/actions?limit=50&cursor=...&kind=...&priority=...&assignedToMe=...
// Returns: { items: WorkItem[], nextCursor: string | null, totalCount: number, hasMore: boolean }
export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  const limitParam = Number(searchParams.get("limit") || "50");
  const limit = Math.min(Math.max(1, limitParam), 100);
  const cursorParam = searchParams.get("cursor");

  const cursorOffset = cursorParam ? Math.max(0, parseInt(cursorParam, 10) || 0) : 0;
  const shipmentId = searchParams.get("shipmentId") || undefined;

  const loaderResult = await loadWorkQueueForAccount(ctx.accountId, ctx.userId, { shipmentId });
  const fullQueue = buildWorkQueue(loaderResult.input);
  const filter = parseWorkFilter(searchParams);

  const filtered = filterWorkQueue(fullQueue, filter);
  const totalCount = filtered.length;

  const pageItems = filtered.slice(cursorOffset, cursorOffset + limit);
  const nextOffset = cursorOffset + limit;
  const hasMore = nextOffset < totalCount;
  const nextCursor = hasMore ? String(nextOffset) : null;

  return NextResponse.json({
    items: pageItems,
    nextCursor,
    totalCount,
    hasMore,
  });
});
