import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productIdParamSchema, productIdentifierInputSchema } from "@/modules/product/productSchemas";
import { addIdentifier } from "@/modules/product/productService";

type Params = { id: string };

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productIdentifierInputSchema, requestId);
    if ("response" in body) return body.response;

    const identifier = await addIdentifier(productActor(ctx, requestId), path.data.id, {
      ...body.data,
      issuerPartyId: body.data.issuerPartyId ?? null,
    });

    return NextResponse.json({ identifier, requestId }, { status: 201 });
  },
  { permission: "products.edit", write: true }
);
