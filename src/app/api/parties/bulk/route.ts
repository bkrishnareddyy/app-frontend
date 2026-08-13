import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { bulkCreatePartySchema } from "@/modules/party/partySchemas";
import { bulkCreateParties } from "@/modules/party/partyImportService";

/**
 * Bulk create from JSON — the machine-integration counterpart to
 * `/api/parties/import/{preview,commit}` for a caller that already has
 * structured records rather than a spreadsheet. Authenticated the same way
 * as every other route here (a Clerk session, not a service credential), so
 * this is not yet callable by an external system without one; it is shaped
 * so that a later API-key layer only has to change how the caller
 * authenticates, not this request or response shape.
 */
export const POST = withAuthenticatedRoute(
  async ({ req, ctx, requestId }) => {
    const body = await parseAndValidateBody(req, bulkCreatePartySchema, requestId);
    if ("response" in body) return body.response;

    const result = await bulkCreateParties(partyActor(ctx, requestId), body.data.items);
    return NextResponse.json({ result, requestId });

}, { permission: "parties.edit", write: true });
