import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const decisions = await db.agentDecision.findMany({
    where: { accountId: ctx.accountId },
    include: {
      shipment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ decisions });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
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
});
