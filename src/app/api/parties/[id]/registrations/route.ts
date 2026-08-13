import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyIdParamSchema, partyRegistrationInputSchema } from "@/modules/party/partySchemas";
import { addRegistration } from "@/modules/party/partyService";

type Params = { id: string };

/**
 * Records a registration.
 *
 * A registration always lands CLAIMED, whatever the source: nothing here
 * fabricates verification. Verifying it against evidence is a separate,
 * separately permissioned act at the registration's own review endpoint.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, partyRegistrationInputSchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await addRegistration(partyActor(ctx, requestId), path.data.id, body.data);

    return NextResponse.json({ changes: outcome.changes, raisedFlags: outcome.raisedFlags, requestId },
      { status: 201 }
    );

}, { permission: "parties.edit", write: true });
