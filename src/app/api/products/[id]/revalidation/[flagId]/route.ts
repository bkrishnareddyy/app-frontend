import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { productActor } from "@/modules/product/productActor";
import { resolveRevalidationFlag } from "@/modules/product/productService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  flagId: z.string().trim().min(1).max(64),
});

const bodySchema = z.object({
  action: z.enum(["RESOLVE", "DISMISS"]),
  note: z.string().trim().max(2000).optional(),
});

type Params = z.infer<typeof paramsSchema>;

/**
 * Closes a revalidation flag.
 *
 * A flag is a workflow signal, not a customs decision: closing one records that
 * a person looked, and changes no classification, origin or valuation. Both
 * outcomes need an identified user, which is why DISMISS is a distinct action
 * rather than a silent delete.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, bodySchema, requestId);
    if ("response" in body) return body.response;

    const flag = await resolveRevalidationFlag(
      productActor(ctx, requestId),
      path.data.id,
      path.data.flagId,
      body.data.action,
      body.data.note ?? null
    );

    return NextResponse.json({ flag, requestId });
  },
  { permission: "products.edit", write: true }
);
