import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyMatchRequestSchema } from "@/modules/party/partySchemas";
import { findPartyMatches } from "@/modules/party/partyService";

/**
 * Read-only deterministic matching, expressed as POST because the candidate
 * is a body rather than query params. No fuzzy or embedding-based matching:
 * see `matchParty` for the exact rule set.
 */
export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await parseAndValidateBody(req, partyMatchRequestSchema, requestId);
  if ("response" in body) return body.response;

  const match = await findPartyMatches(partyActor(ctx, requestId), body.data);

  return NextResponse.json({ match, requestId });
});
