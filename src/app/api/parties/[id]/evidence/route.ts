import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyEvidenceInputSchema, partyIdParamSchema } from "@/modules/party/partySchemas";
import { addEvidence } from "@/modules/party/partyService";

type Params = { id: string };

/**
 * Attaches evidence to a party.
 *
 * A referenced document or extracted fact is checked against the caller's
 * account before it is stored, so evidence cannot be made to point at another
 * tenant's document. Nothing here invents provenance: evidence that points at
 * nothing is rejected by the schema.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, partyEvidenceInputSchema, requestId);
    if ("response" in body) return body.response;

    const evidence = await addEvidence(partyActor(ctx, requestId), path.data.id, body.data);
    return NextResponse.json({ evidence, requestId });

}, { permission: "parties.edit", write: true });
