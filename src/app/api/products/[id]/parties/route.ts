import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productIdParamSchema, productPartyInputSchema } from "@/modules/product/productSchemas";
import { addParty } from "@/modules/product/productService";

type Params = { id: string };

/**
 * Attaches a manufacturer, supplier or brand owner.
 *
 * Naming a manufacturer records where the goods are made. It does not set, and
 * must never be read as, the country of origin — the flags this raises ask a
 * person to look at origin again, they do not answer the question.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productPartyInputSchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await addParty(productActor(ctx, requestId), path.data.id, body.data);

    return NextResponse.json({ changes: outcome.changes, raisedFlags: outcome.raisedFlags, requestId },
      { status: 201 }
    );

}, { permission: "products.edit", write: true });
