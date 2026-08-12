import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { classificationReviewSchema } from "@/modules/product/productSchemas";
import { reviewClassification } from "@/modules/product/productService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  classificationId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

/**
 * Moves a classification through its lifecycle.
 *
 * The route requires products.edit; APPROVE additionally requires
 * products.classification.approve, which is enforced inside
 * `reviewClassification` from the actor rather than here, so the rule cannot be
 * bypassed by a caller that is not an HTTP request. An approval also requires a
 * named reviewer and a status of UNDER_REVIEW — a CANDIDATE cannot jump
 * straight to APPROVED.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, classificationReviewSchema, requestId);
    if ("response" in body) return body.response;

    const classification = await reviewClassification(
      productActor(ctx, requestId),
      path.data.id,
      path.data.classificationId,
      body.data.action,
      { reviewNote: body.data.reviewNote ?? null, effectiveFrom: body.data.effectiveFrom }
    );

    return NextResponse.json({ classification, requestId });
  },
  { permission: "products.edit", write: true }
);
