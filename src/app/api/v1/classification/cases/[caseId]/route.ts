import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ClassificationCaseRepository } from "@/repositories/classificationCaseRepository";

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const { caseId } = await params;
    const classificationCase = await ClassificationCaseRepository.getById(ctx!.accountId, caseId);

    if (!classificationCase) {
      return NextResponse.json({ error: "Classification case not found" }, { status: 404 });
    }

    return NextResponse.json({ classificationCase });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch classification case" }, { status: 500 });
  }
}
