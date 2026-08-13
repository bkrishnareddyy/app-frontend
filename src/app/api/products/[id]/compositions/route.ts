import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productCompositionInputSchema, productIdParamSchema } from "@/modules/product/productSchemas";
import { addComposition } from "@/modules/product/productService";

type Params = { id: string };

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productCompositionInputSchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await addComposition(productActor(ctx, requestId), path.data.id, body.data);

    // Composition always bears on classification and origin, so a caller adding
    // a material should expect flags back and is told so here.
    return NextResponse.json({ changes: outcome.changes, raisedFlags: outcome.raisedFlags, requestId },
      { status: 201 }
    );

}, { permission: "products.edit", write: true });
