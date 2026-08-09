import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const claim = await db.drawbackClaim.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      matches: {
        include: {
          shipmentLineItem: true,
          exportLineItem: true,
        },
      },
    },
  });

  if (!claim) {
    return NextResponse.json({ error: "Drawback claim not found" }, { status: 404 });
  }

  return NextResponse.json({ drawbackClaim: claim });
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { status, totalRefundClaimed } = body;

  const existingClaim = await db.drawbackClaim.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!existingClaim) {
    return NextResponse.json({ error: "Drawback claim not found" }, { status: 404 });
  }

  const updateData: import("@prisma/client").Prisma.DrawbackClaimUpdateInput = {};
  if (status) {
    return NextResponse.json(
      { error: "Forbidden: State mutations must be performed via the workflow engine." },
      { status: 403 }
    );
  }
  if (totalRefundClaimed !== undefined) updateData.totalRefundClaimed = totalRefundClaimed;

  const updatedClaim = await db.drawbackClaim.update({
    where: { id },
    data: updateData,
    include: { matches: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "drawback.claim_update",
    entity: "DrawbackClaim",
    entityId: id,
    metadata: { newStatus: status || existingClaim.status },
  });

  return NextResponse.json({ drawbackClaim: updatedClaim });
}, { write: true });
