import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { holdsPermission, productActor } from "@/modules/product/productActor";
import { countryFactReviewSchema } from "@/modules/product/productSchemas";
import { reviewCountryFact } from "@/modules/product/productService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  factId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

/**
 * Moves a country fact through its review.
 *
 * The route is gated on products.edit because opening a review and rejecting a
 * claim are ordinary editing. Marking a claim VERIFIED is not — it is the point
 * at which someone in the account vouches for the origin against its evidence —
 * so it additionally requires products.origin.verify.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, countryFactReviewSchema, requestId);
    if ("response" in body) return body.response;

    if (body.data.action === "VERIFY" && !holdsPermission(ctx, "products.origin.verify")) {
      return buildErrorResponse(
        403,
        "FORBIDDEN",
        "Missing required permission: products.origin.verify",
        undefined,
        requestId
      );
    }

    const fact = await reviewCountryFact(
      productActor(ctx, requestId),
      path.data.id,
      path.data.factId,
      body.data.action,
      body.data.reviewNote ?? null
    );

    return NextResponse.json({ countryFact: fact, requestId });
  },
  { permission: "products.edit", write: true }
);
