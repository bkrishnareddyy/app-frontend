import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productIdParamSchema } from "@/modules/product/productSchemas";
import { getProductHistory } from "@/modules/product/productService";

type Params = { id: string };

export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, productIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const events = await getProductHistory(productActor(ctx, requestId), path.data.id);
  return NextResponse.json({ events, requestId });
});
