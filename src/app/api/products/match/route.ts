import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productMatchRequestSchema } from "@/modules/product/productSchemas";
import { findProductMatches } from "@/modules/product/productService";

/**
 * Matches an incoming line against the account's catalogue.
 *
 * The matching is deterministic and rule-based: it reports which rule fired and
 * why, and it returns AMBIGUOUS rather than picking a winner when more than one
 * product satisfies the same rule. There is no similarity score and no
 * embedding, so a caller never receives a confident-looking guess.
 *
 * This is a read, expressed as POST because the candidate is a body rather than
 * a URL. It creates nothing and links nothing.
 */
export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await parseAndValidateBody(req, productMatchRequestSchema, requestId);
  if ("response" in body) return body.response;

  const match = await findProductMatches(productActor(ctx, requestId), {
    productName: body.data.productName ?? null,
    brand: body.data.brand ?? null,
    manufacturerPartyId: body.data.manufacturerPartyId ?? null,
    identifiers: body.data.identifiers ?? [],
  });

  return NextResponse.json({ match, requestId });
});
