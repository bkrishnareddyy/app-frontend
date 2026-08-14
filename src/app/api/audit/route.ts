import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entityId");
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");
  const page = pageParam ? Math.max(1, parseInt(pageParam)) : 1;
  const rawLimit = limitParam ? parseInt(limitParam) : 50;
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);
  const skip = (page - 1) * limit;

  const whereClause: Prisma.AuditLogWhereInput = {
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
