import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { reviewKeywordRule } from "@/modules/complianceKeywordRules/keywordRuleReviewService";

type Params = { id: string };

const pathSchema = z.object({
  id: z.string().min(1),
});

const bodySchema = z.object({
  action: z.enum(["PUBLISH", "REJECT"]),
  reviewNote: z.string().max(2000).optional(),
});

export const POST = withAuthenticatedRoute<Params>(async ({ req, ctx, params, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const path = validatePathParams(params, pathSchema, requestId);
  if ("response" in path) return path.response;

  const body = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in body) return body.response;

  const auditSource = (req.headers?.get?.("x-qubere-source") === "CHAT" || (body.data as any)?.source === "CHAT") ? "CHAT" : "UI";

  const updated = await reviewKeywordRule(
    { accountId: ctx.accountId, userId: ctx.userId, requestId, source: auditSource },
    path.data.id,
    body.data.action,
    body.data.reviewNote ?? null
  );

  return NextResponse.json({ item: updated, requestId });
});
