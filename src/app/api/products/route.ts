import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validateQueryParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { createProductSchema, productListQuerySchema } from "@/modules/product/productSchemas";
import { parseProductQuery } from "@/modules/product/productQuery";
import { createProduct, listProducts } from "@/modules/product/productService";

/**
 * The product catalogue for the caller's account.
 *
 * Reading is authenticated but not permission-gated, matching GET /api/shipments:
 * everyone with a seat in the account can see the item master. Every write below
 * and in the nested routes is gated individually.
 */
export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const url = new URL(req.url);

  // Validated first so a malformed page or an unknown status is a 400 rather
  // than a silent fallback to page 1 of everything.
  const validated = validateQueryParams(url.toString(), productListQuerySchema, requestId);
  if ("response" in validated) return validated.response;

  const query = parseProductQuery(url.searchParams);
  const { rows, total } = await listProducts(productActor(ctx, requestId), query);

  return NextResponse.json({
    products: rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    direction: query.direction,
    requestId,
  });
});

export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, createProductSchema, requestId);
    if ("response" in body) return body.response;

    const product = await createProduct(productActor(ctx, requestId), body.data);
    return NextResponse.json({ product, requestId });

}, { permission: "products.create", write: true });
