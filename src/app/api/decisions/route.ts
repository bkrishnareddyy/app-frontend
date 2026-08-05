import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function GET() {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decisions = await db.agentDecision.findMany({
      where: { accountId: ctx.accountId },
      include: {
        shipment: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ decisions });
  } catch (error) {
    console.error("GET /api/decisions error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { decisionId, action, humanNotes } = body; // action: APPROVE, REJECT, RE_EVALUATE

    const decision = await db.agentDecision.findFirst({
      where: { id: decisionId, accountId: ctx.accountId },
    });

    if (!decision) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }

    const newStatus = action === "APPROVE" ? "Approved" : action === "REJECT" ? "Rejected" : "In Progress";

    const updatedDecision = await db.agentDecision.update({
      where: { id: decisionId },
      data: {
        status: newStatus,
        humanNotes: humanNotes || decision.humanNotes,
        reviewedByUserId: ctx.userId,
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: `decision.${action.toLowerCase()}`,
      entity: "AgentDecision",
      entityId: decisionId,
      metadata: { newStatus, humanNotes },
    });

    return NextResponse.json({ decision: updatedDecision });
  } catch (error) {
    console.error("POST /api/decisions error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
