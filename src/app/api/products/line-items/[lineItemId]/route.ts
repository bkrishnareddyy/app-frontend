import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { attachLineItemToProduct, matchShipmentLine } from "@/modules/product/productService";

const paramsSchema = z.object({
  lineItemId: z.string().trim().min(1).max(64),
});

/**
 * Only the product is supplied. The match status is derived here from what the
 * matcher actually concluded, never taken from the request — a client that could
 * post `matchStatus: "EXACT_MATCH"` could dress a guess up as an identification.
 */
const bodySchema = z.object({
  productId: z.string().trim().min(1).max(64).nullable(),
});

type Params = z.infer<typeof paramsSchema>;

/** What the matcher makes of this line, so a reviewer can choose from candidates. */
export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, paramsSchema, requestId);
  if ("response" in path) return path.response;

  const { line, match } = await matchShipmentLine(productActor(ctx, requestId), path.data.lineItemId);
  return NextResponse.json({ line, match, requestId });
});

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, bodySchema, requestId);
    if ("response" in body) return body.response;

    const actor = productActor(ctx, requestId);
    const { productId } = body.data;

    if (productId === null) {
      const line = await attachLineItemToProduct(actor, path.data.lineItemId, null, "NO_MATCH");
      return NextResponse.json({ lineItem: line, requestId });
    }

    // Re-run the matcher and record what it found. A product the matcher reached
    // unambiguously is stored as the match it is; a product a person picked from
    // candidates the matcher could not separate is stored as POSSIBLE_MATCH, so
    // the line reads as "someone accepted a suggestion" rather than "the system
    // determined this".
    const { match } = await matchShipmentLine(actor, path.data.lineItemId);
    const reached =
      match.candidates.length === 1 && match.candidates[0]?.productId === productId
        ? match.status
        : "POSSIBLE_MATCH";

    const line = await attachLineItemToProduct(
      actor,
      path.data.lineItemId,
      productId,
      reached === "NO_MATCH" ? "POSSIBLE_MATCH" : reached
    );

    return NextResponse.json({ lineItem: line, matchStatus: reached, requestId });

}, { permission: "products.edit", write: true });
