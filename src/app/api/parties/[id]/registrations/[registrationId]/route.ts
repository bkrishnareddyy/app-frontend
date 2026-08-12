import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyRegistrationReviewSchema } from "@/modules/party/partySchemas";
import { reviewRegistration } from "@/modules/party/partyService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  registrationId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

/**
 * Moves a registration through its lifecycle.
 *
 * The route requires parties.edit; VERIFY additionally requires
 * parties.registration.verify and a piece of evidence, both enforced inside
 * `reviewRegistration` from the actor rather than here, so the rule cannot be
 * bypassed by a caller that is not an HTTP request. Nothing here infers
 * verification from the registration number merely looking well-formed.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, partyRegistrationReviewSchema, requestId);
    if ("response" in body) return body.response;

    const registration = await reviewRegistration(
      partyActor(ctx, requestId),
      path.data.id,
      path.data.registrationId,
      body.data.action,
      { reviewNote: body.data.reviewNote ?? null, evidenceId: body.data.evidenceId ?? null }
    );

    return NextResponse.json({ registration, requestId });
  },
  { permission: "parties.edit", write: true }
);
