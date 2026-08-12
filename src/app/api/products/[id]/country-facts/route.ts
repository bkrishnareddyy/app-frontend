import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productCountryFactInputSchema, productIdParamSchema } from "@/modules/product/productSchemas";
import { addCountryFact } from "@/modules/product/productService";

type Params = { id: string };

/**
 * Records a country fact.
 *
 * `factType` is required by the schema, so the caller has to say whether it is
 * asserting where the goods are manufactured, where they are produced, or what
 * origin is being claimed. The fact lands CLAIMED; verifying it is a separate,
 * separately permissioned act.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productCountryFactInputSchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await addCountryFact(productActor(ctx, requestId), path.data.id, body.data);

    return NextResponse.json(
      { changes: outcome.changes, raisedFlags: outcome.raisedFlags, requestId },
      { status: 201 }
    );
  },
  { permission: "products.edit", write: true }
);
