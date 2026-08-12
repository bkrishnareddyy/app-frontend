import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyIdParamSchema, partyReviewActionSchema } from "@/modules/party/partySchemas";
import { reviewParty } from "@/modules/party/partyService";

type Params = { id: string };

/**
 * Moves a party's master data through its review.
 *
 * The route requires parties.edit; APPROVE additionally requires
 * parties.review.approve, which is enforced inside `reviewParty` from the
 * actor rather than here, so the rule cannot be bypassed by a caller that is
 * not an HTTP request. Approving records who looked and does not mean this
 * party has been checked against any list.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, partyReviewActionSchema, requestId);
    if ("response" in body) return body.response;

    const party = await reviewParty(
      partyActor(ctx, requestId),
      path.data.id,
      body.data.action,
      body.data.reviewNote ?? null
    );

    return NextResponse.json({ party, requestId });
  },
  { permission: "parties.edit", write: true }
);
