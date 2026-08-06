import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

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
    const { status, assignedToUserId, description, severity } = body;

    const exceptionItem = await db.exceptionItem.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!exceptionItem) {
      return NextResponse.json({ error: "Exception item not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status;
      if (status === "Resolved" && !exceptionItem.resolvedAt) {
        updateData.resolvedAt = new Date();
      }
    }
    if (assignedToUserId !== undefined) updateData.assignedToUserId = assignedToUserId;
    if (description) updateData.description = description;
    if (severity) updateData.severity = severity;

    const updatedException = await db.exceptionItem.update({
      where: { id },
      data: updateData,
      include: { assignedToUser: true, shipment: true },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "exception.update",
      entity: "ExceptionItem",
      entityId: id,
      metadata: { newStatus: status || exceptionItem.status, assignedToUserId },
    });

    return NextResponse.json({ exception: updatedException });
  } catch (error) {
    console.error("PATCH /api/exceptions/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
