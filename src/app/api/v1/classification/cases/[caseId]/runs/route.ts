import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";

export async function POST(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const { caseId } = await params;
    const result = await ClassificationCaseEngine.processCase(ctx!.accountId, ctx!.userId, caseId);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to process classification case" }, { status: 500 });
  }
}
