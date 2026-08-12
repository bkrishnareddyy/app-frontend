import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { removeComposition } from "@/modules/product/productService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  compositionId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

export const DELETE = withAuthenticatedRoute<Params>(
  async ({ ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const outcome = await removeComposition(
      productActor(ctx, requestId),
      path.data.id,
      path.data.compositionId
    );

    return NextResponse.json({
      removed: true,
      changes: outcome.changes,
      raisedFlags: outcome.raisedFlags,
      requestId,
    });
  },
  { permission: "products.edit", write: true }
);
