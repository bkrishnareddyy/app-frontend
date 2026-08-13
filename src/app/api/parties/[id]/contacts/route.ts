import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyContactInputSchema, partyIdParamSchema } from "@/modules/party/partySchemas";
import { addContact } from "@/modules/party/partyService";

type Params = { id: string };

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, partyContactInputSchema, requestId);
    if ("response" in body) return body.response;

    const contact = await addContact(partyActor(ctx, requestId), path.data.id, body.data);

    return NextResponse.json({ contact, requestId });

}, { permission: "parties.edit", write: true });
