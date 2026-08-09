import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { BatchClassificationService } from "@/modules/classification/batchClassificationService";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  try {
    const body = await req.json();
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: "items array is required" }, { status: 400 });
    }

    const batchResult = await BatchClassificationService.submitBatch(ctx.accountId, ctx.userId, items);
    return NextResponse.json(batchResult, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to submit batch classification" }, { status: 400 });
  }
});
