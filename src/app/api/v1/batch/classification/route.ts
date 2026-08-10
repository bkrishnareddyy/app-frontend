import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
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
  } catch (error: unknown) {
    return handleApiError(error);
  }
}, { write: true });
