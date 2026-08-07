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

    const psc = await db.postSummaryCorrection.findFirst({
      where: { id, accountId: ctx.accountId },
      include: {
        originalFiling: {
          include: { shipment: true },
        },
        refundOpportunity: true,
      },
    });

    if (!psc) {
      return NextResponse.json({ error: "PSC not found" }, { status: 404 });
    }

    return NextResponse.json({ psc });
  } catch (error) {
    console.error("GET /api/refunds/psc/[id] error:", error);
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
    const { status, cbpResponseCode, correctedDutyAmount } = body;

    const existingPsc = await db.postSummaryCorrection.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!existingPsc) {
      return NextResponse.json({ error: "PSC not found" }, { status: 404 });
    }

    const updateData: import("@prisma/client").Prisma.PostSummaryCorrectionUpdateInput = {};
    if (status) {
      return NextResponse.json(
        { error: "Forbidden: State mutations must be performed via the workflow engine." },
        { status: 403 }
      );
    }

    if (cbpResponseCode) updateData.cbpResponseCode = cbpResponseCode;
    if (correctedDutyAmount !== undefined) {
      updateData.correctedDutyAmount = correctedDutyAmount;
      updateData.refundAmount = Math.max(0, Number(existingPsc.originalDutyAmount) - correctedDutyAmount);
    }

    const updatedPsc = await db.postSummaryCorrection.update({
      where: { id },
      data: updateData,
      include: { originalFiling: true },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "psc.update",
      entity: "PostSummaryCorrection",
      entityId: id,
      metadata: { newStatus: status || existingPsc.status },
    });

    return NextResponse.json({ psc: updatedPsc });
  } catch (error) {
    console.error("PATCH /api/refunds/psc/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
