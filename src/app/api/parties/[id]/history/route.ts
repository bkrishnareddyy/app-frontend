import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { partyIdParamSchema } from "@/modules/party/partySchemas";
import { getPartyHistory } from "@/modules/party/partyService";

type Params = { id: string };

export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, partyIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const events = await getPartyHistory(partyActor(ctx, requestId), path.data.id);
  return NextResponse.json({ events, requestId });
});
