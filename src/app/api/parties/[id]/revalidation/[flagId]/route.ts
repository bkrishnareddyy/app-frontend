import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { partyActor } from "@/modules/party/partyActor";
import { resolveRevalidationFlag } from "@/modules/party/partyService";

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  flagId: z.string().trim().min(1).max(64),
});

type Params = z.infer<typeof paramsSchema>;

const bodySchema = z.object({
  action: z.enum(["RESOLVE", "DISMISS"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Resolves or dismisses a revalidation flag.
 *
 * The route requires only parties.edit; the finer-grained
 * parties.revalidation.resolve permission and the "must be a named reviewer,
 * not a service account" check are both enforced unconditionally inside
 * `resolveRevalidationFlag` itself, so they cannot be bypassed by a caller
 * that is not an HTTP request.
 */
export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, bodySchema, requestId);
    if ("response" in body) return body.response;

    await resolveRevalidationFlag(
      partyActor(ctx, requestId),
      path.data.id,
      path.data.flagId,
      body.data.action,
      body.data.note ?? null
    );

    return NextResponse.json({ resolved: true, requestId });

}, { permission: "parties.revalidation.resolve", write: true });
