import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { ProductMasterService } from "@/modules/product/productMasterService";
import { z } from "zod";

const paramsSchema = z.object({ productId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ productId: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { productId } = paramsVal.data;

  try {
    const body = await req.json();
    const { decisionId } = body;

    if (!decisionId) {
      return NextResponse.json({ error: "decisionId is required" }, { status: 400 });
    }

    const product = await ProductMasterService.bindClassification({
      accountId: ctx.accountId,
      userId: ctx.userId,
      canonicalProductId: productId,
      decisionId,
    });

    return NextResponse.json({ product });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to bind classification decision" }, { status: 500 });
  }
});
