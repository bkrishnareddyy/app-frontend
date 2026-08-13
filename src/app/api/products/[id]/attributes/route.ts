import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productAttributeInputSchema, productIdParamSchema } from "@/modules/product/productSchemas";
import { setAttribute } from "@/modules/product/productService";

type Params = { id: string };

/**
 * Sets an attribute. An existing active value for the same code is superseded
 * rather than overwritten, so this is a POST that is safe to repeat.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productAttributeInputSchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await setAttribute(productActor(ctx, requestId), path.data.id, body.data);

    return NextResponse.json({ changes: outcome.changes, raisedFlags: outcome.raisedFlags, requestId },
      { status: 201 }
    );

}, { permission: "products.edit", write: true });
