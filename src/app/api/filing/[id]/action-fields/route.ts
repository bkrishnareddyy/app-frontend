import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams, validateQueryParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { resolveMessageContext } from "@/lib/canonicalMessaging/resolveMessageContext";
import { resolveActionDataFields } from "@/lib/canonicalMessaging/actionDataRequirements";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const querySchema = z.object({ action: z.enum(["SUBMIT", "AMENDMENT", "CANCELLATION", "RESUBMIT", "STATUS_INQUIRY"]) });

/**
 * What the child-action confirmation modal renders before the operator
 * submits: the resolved field tree for this filing's (country, procedure,
 * messageName) and the given action. Read-only, no side effects -- separate
 * from actually invoking the action (POST .../cancel etc.), so a UI can
 * render prompts before committing to anything.
 */
export const GET = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const queryVal = validateQueryParams(req.url, querySchema, requestId);
  if ("response" in queryVal) return queryVal.response;
  const { action } = queryVal.data;

  const filing = await db.customsFiling.findFirst({
    where: { id, accountId: ctx.accountId },
    include: { shipment: true },
  });
  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Filing case not found", undefined, requestId);
  }

  // Use procedureCode directly (it now stores transaction type like IMPORT, EXPORT)
  const context = await resolveMessageContext(
    { 
      transactionType: filing.procedureCode || "IMPORT", // procedureCode now contains transaction type
      procedureCode: filing.procedureCode || filing.entryType || "01",
      country: filing.country || filing.shipment?.destinationCountry || "US"
    },
    action
  );

  const fields = await resolveActionDataFields(
    { country: context.country, procedureCode: context.procedure, messageName: context.messageName },
    action
  );

  return NextResponse.json({ fields, requestId });
});
