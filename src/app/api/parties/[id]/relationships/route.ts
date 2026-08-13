import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyIdParamSchema, partyRelationshipInputSchema } from "@/modules/party/partySchemas";
import { addRelationship } from "@/modules/party/partyService";

type Params = { id: string };

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, partyRelationshipInputSchema, requestId);
    if ("response" in body) return body.response;

    const relationship = await addRelationship(partyActor(ctx, requestId), path.data.id, body.data);

    return NextResponse.json({ relationship, requestId });

}, { permission: "parties.edit", write: true });
