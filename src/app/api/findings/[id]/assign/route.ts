import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(
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
  } catch (error) {
    console.error("POST /api/findings/[id]/assign error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
