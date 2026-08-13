import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productEvidenceInputSchema, productIdParamSchema } from "@/modules/product/productSchemas";
import { addEvidence } from "@/modules/product/productService";

type Params = { id: string };

/**
 * Attaches evidence to a product.
 *
 * A referenced document or extracted fact is checked against the caller's
 * account before it is stored, so evidence cannot be made to point at another
 * tenant's document. Nothing here invents provenance: evidence that points at
 * nothing is rejected by the schema.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productEvidenceInputSchema, requestId);
    if ("response" in body) return body.response;

    const evidence = await addEvidence(productActor(ctx, requestId), path.data.id, body.data);
    return NextResponse.json({ evidence, requestId });

}, { permission: "products.edit", write: true });
