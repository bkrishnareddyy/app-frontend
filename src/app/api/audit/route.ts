import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entityId");
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");
  const page = pageParam ? parseInt(pageParam) : 1;
  const limit = limitParam ? parseInt(limitParam) : 50;
  const skip = (page - 1) * limit;

  const whereClause: any = {
    accountId: ctx.accountId,
  };

  if (entityId) whereClause.entityId = entityId;
  if (entity) whereClause.entity = entity;
  if (action) whereClause.action = action;

  if (fromParam || toParam) {
    whereClause.createdAt = {};
    if (fromParam) whereClause.createdAt.gte = new Date(fromParam);
    if (toParam) whereClause.createdAt.lte = new Date(toParam);
  }

  const logs = await db.auditLog.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const count = await db.auditLog.count({
    where: whereClause,
  });

  return NextResponse.json({
    logs,
    count,
    page,
    totalPages: Math.ceil(count / limit),
  });
});
