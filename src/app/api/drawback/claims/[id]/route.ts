import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

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
  } catch (error) {
    console.error("GET /api/drawback/claims/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
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
      updateData.status = status;
      if (status === "Filed" && !existingClaim.filedAt) updateData.filedAt = new Date();
      if (status === "Paid" && !existingClaim.paidAt) updateData.paidAt = new Date();
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
  } catch (error) {
    console.error("PATCH /api/drawback/claims/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
