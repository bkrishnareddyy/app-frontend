import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productIdParamSchema, updateProductSchema } from "@/modules/product/productSchemas";
import { archiveProduct, getProduct, updateProduct } from "@/modules/product/productService";

type Params = { id: string };

export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, productIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const product = await getProduct(productActor(ctx, requestId), path.data.id);
  if (product === null) {
    // A product belonging to another account is reported as absent, not as
    // forbidden: a 403 would confirm that the id exists somewhere.
    return buildErrorResponse(404, "PRODUCT_NOT_FOUND", "No such product.", undefined, requestId);
  }

  return NextResponse.json({ product, requestId });
});

export const PATCH = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, updateProductSchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await updateProduct(productActor(ctx, requestId), path.data.id, body.data);

    // The changes and the flags they raised are returned alongside the product
    // so the caller learns immediately that its edit put a classification back
    // in question, rather than discovering it on the next page load.
    return NextResponse.json({
      product: outcome.result,
      changes: outcome.changes,
      raisedFlags: outcome.raisedFlags,
      requestId,
});
  });

/** Soft delete. The row, its history and its evidence stay readable to an audit. */
export const DELETE = withAuthenticatedRoute<Params>(
  async ({ ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    await archiveProduct(productActor(ctx, requestId), path.data.id);
    return NextResponse.json({ archived: true, requestId });

}, { permission: "products.edit", write: true });
