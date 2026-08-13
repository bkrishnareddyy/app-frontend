import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { removeName } from "@/modules/party/partyService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  nameId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

export const DELETE = withAuthenticatedRoute<Params>(
  async ({ ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const outcome = await removeName(partyActor(ctx, requestId), path.data.id, path.data.nameId);

    return NextResponse.json({
      removed: true,
      changes: outcome.changes,
      raisedFlags: outcome.raisedFlags,
      requestId,
});
  
}, { permission: "parties.edit", write: true });
