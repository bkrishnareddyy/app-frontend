import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validateQueryParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { createPartySchema, partyListQuerySchema } from "@/modules/party/partySchemas";
import { parsePartyQuery } from "@/modules/party/partyQuery";
import { createParty, listParties } from "@/modules/party/partyService";

/**
 * The party master for the caller's account.
 *
 * Reading is authenticated but not permission-gated, matching GET /api/products:
 * everyone with a seat in the account can see who is on file. Every write below
 * and in the nested routes is gated individually.
 */
export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const url = new URL(req.url);

  const validated = validateQueryParams(url.toString(), partyListQuerySchema, requestId);
  if ("response" in validated) return validated.response;

  const query = parsePartyQuery(url.searchParams);
  const { rows, total } = await listParties(partyActor(ctx, requestId), query);

  return NextResponse.json({
    parties: rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    direction: query.direction,
    requestId,
  });
});

export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, createPartySchema, requestId);
    if ("response" in body) return body.response;

    const party = await createParty(partyActor(ctx, requestId), body.data);
    return NextResponse.json({ party, requestId });

}, { permission: "parties.create", write: true });
