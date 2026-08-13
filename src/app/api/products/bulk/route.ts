import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { bulkCreateProductSchema } from "@/modules/product/productSchemas";
import { bulkCreateProducts } from "@/modules/product/productImportService";

/**
 * Bulk create from JSON — the machine-integration counterpart to
 * `/api/products/import/{preview,commit}` for a caller that already has
 * structured records rather than a spreadsheet. Authenticated the same way
 * as every other route here (a Clerk session, not a service credential), so
 * this is not yet callable by an external system without one; it is shaped
 * so that a later API-key layer only has to change how the caller
 * authenticates, not this request or response shape.
 */
export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, bulkCreateProductSchema, requestId);
    if ("response" in body) return body.response;

    const result = await bulkCreateProducts(productActor(ctx, requestId), body.data.items);
    return NextResponse.json({ result, requestId });

}, { permission: "products.edit", write: true });
