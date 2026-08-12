import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { COPILOT_ACTION_TYPES } from "@/modules/copilot/copilotContract";
import { actionHref, actionSubject } from "@/modules/copilot/copilotActions";
import { auditNavigationAction } from "@/modules/copilot/copilotAudit";

const navigationSchema = z.object({
  type: z.enum(COPILOT_ACTION_TYPES),
  entityId: z.string().trim().min(1).max(64),
  conversationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  /** Present for VIEW_EVIDENCE, whose route is under the owning record's page. */
  evidenceOwner: z
    .object({ type: z.enum(["PRODUCT", "PARTY"]), id: z.string().trim().min(1).max(64) })
    .optional(),
});

/**
 * Records that a user followed a Copilot suggestion.
 *
 * This exists for the audit trail the specification asks for: a compliance
 * reviewer should be able to see not only what the Copilot said but which of its
 * suggestions someone acted on. It writes an audit entry and returns the route.
 *
 * It grants nothing. The href is rebuilt here from the action type and the id
 * rather than accepted from the body, so a client cannot log — or be handed — a
 * route the mapping does not produce. And the destination page enforces its own
 * authentication, tenancy and permissions when it loads, exactly as it does when
 * reached from the sidebar. An id posted here that the caller cannot actually
 * open produces an audit entry and a page that refuses them.
 */
export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await parseAndValidateBody(req, navigationSchema, requestId);
  if ("response" in body) return body.response;

  const { type, entityId, evidenceOwner, conversationId } = body.data;
  const href = actionHref(type, entityId, evidenceOwner ?? null);

  if (!href) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "That action has no route." }, requestId },
      { status: 400 }
    );
  }

  const subject = actionSubject(type);

  await auditNavigationAction(
    {
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId,
      conversationId: conversationId ?? requestId,
    },
    { actionType: type, entityType: subject, entityId, href }
  );

  // No telemetry event: the observability contract covers the answering
  // pipeline, and a click is fully described by its audit entry.
  return NextResponse.json({ href, requestId });
});
