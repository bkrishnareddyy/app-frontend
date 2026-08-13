import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyIdParamSchema, updatePartySchema } from "@/modules/party/partySchemas";
import { archiveParty, getParty, updateParty } from "@/modules/party/partyService";

type Params = { id: string };

export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, partyIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const party = await getParty(partyActor(ctx, requestId), path.data.id);
  if (party === null) {
    // A party belonging to another account is reported as absent, not as
    // forbidden: a 403 would confirm that the id exists somewhere.
    return buildErrorResponse(404, "PARTY_NOT_FOUND", "No such party.", undefined, requestId);
  }

  return NextResponse.json({ party, requestId });
});

export const PATCH = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, updatePartySchema, requestId);
    if ("response" in body) return body.response;

    const outcome = await updateParty(partyActor(ctx, requestId), path.data.id, body.data);

    // The changes and the flags they raised are returned alongside the party
    // so the caller learns immediately that its edit put the review status
    // back in question, rather than discovering it on the next page load.
    return NextResponse.json({
      party: outcome.result,
      changes: outcome.changes,
      raisedFlags: outcome.raisedFlags,
      requestId,
});
  });

/** Soft delete. The row, its history and its evidence stay readable to an audit. */
export const DELETE = withAuthenticatedRoute<Params>(
  async ({ ctx, params, requestId }) => {
    const path = validatePathParams(params, partyIdParamSchema, requestId);
    if ("response" in path) return path.response;

    await archiveParty(partyActor(ctx, requestId), path.data.id);
    return NextResponse.json({ archived: true, requestId });

}, { permission: "parties.edit", write: true });
