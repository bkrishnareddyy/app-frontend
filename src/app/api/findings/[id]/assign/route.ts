import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { assignedToUserId } = body;

  const finding = await db.complianceFinding.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!finding) {
    return NextResponse.json({ error: "Compliance finding not found" }, { status: 404 });
  }

  const updatedFinding = await db.complianceFinding.update({
    where: { id },
    data: {
      assignedToUserId: assignedToUserId || ctx.userId,
      status: finding.status === "Open" ? "Investigating" : finding.status,
    },
    include: { assignedToUser: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "finding.assign",
    entity: "ComplianceFinding",
    entityId: id,
    metadata: { assignedToUserId: assignedToUserId || ctx.userId },
  });

  return NextResponse.json({ finding: updatedFinding });
});
