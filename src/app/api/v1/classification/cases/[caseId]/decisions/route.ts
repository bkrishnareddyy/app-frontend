import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";

export async function POST(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const { caseId } = await params;
    const body = await req.json();
    const { proposalId, approvedHtsNodeId, decisionStatus, rationale, overrideReason } = body;

    if (!approvedHtsNodeId || !decisionStatus || !rationale) {
      return NextResponse.json({ error: "approvedHtsNodeId, decisionStatus, and rationale are required" }, { status: 400 });
    }

    const decision = await ClassificationCaseEngine.recordDecision({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      caseId,
      proposalId,
      approvedHtsNodeId,
      decisionStatus,
      rationale,
      overrideReason,
    });

    return NextResponse.json({ decision }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to record classification decision" }, { status: 500 });
  }
}
