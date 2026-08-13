import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { removeRelationship } from "@/modules/party/partyService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  relationshipId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

export const DELETE = withAuthenticatedRoute<Params>(
  async ({ ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    await removeRelationship(partyActor(ctx, requestId), path.data.id, path.data.relationshipId);

    return NextResponse.json({ removed: true, requestId });

}, { permission: "parties.edit", write: true });
