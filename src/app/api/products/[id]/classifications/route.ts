import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { productClassificationInputSchema, productIdParamSchema } from "@/modules/product/productSchemas";
import { proposeClassification } from "@/modules/product/productService";
import { db } from "@/lib/db";

type Params = { id: string };

/** E-1: Returns classification history ordered by effectiveDate DESC. */
export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, productIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const classifications = await db.productClassification.findMany({
    where: { productId: path.data.id, accountId: ctx.accountId },
    orderBy: { effectiveFrom: "desc" },
    include: {
      supersededBy: { select: { id: true, classificationCode: true, effectiveFrom: true } },
    },
  });

  return NextResponse.json({ classifications });
});

/**
 * Proposes a classification for one jurisdiction.
 *
 * There is no way to post an approved classification. The status is derived from
 * how the code was arrived at — a person's manual decision or a ruling lands
 * PROPOSED, an agent's or an import's lands CANDIDATE — and reaching APPROVED
 * requires the review endpoint, a named reviewer and products.classification.approve.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, productClassificationInputSchema, requestId);
    if ("response" in body) return body.response;

    const classification = await proposeClassification(
      productActor(ctx, requestId),
      path.data.id,
      body.data
    );

    return NextResponse.json({ classification, requestId });

}, { permission: "products.edit", write: true });
