import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
});

const bodySchema = z.object({
  action: z.enum(["resolve", "ignore"]),
});

export const POST = withAuthenticatedRoute<{ id: string; issueId: string }>(
  async ({ req, ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;
    const { id, issueId } = paramsVal.data;

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const issue = await db.reconciliationIssue.findFirst({
      where: { id: issueId, shipmentId: id, accountId: ctx.accountId },
    });

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const newStatus = parsed.data.action === "ignore" ? "Ignored" : "Resolved";

    await db.reconciliationIssue.update({
      where: { id: issueId },
      data: { status: newStatus, resolvedAt: new Date() },
    });

    return NextResponse.json({ resolved: true, status: newStatus });
  },
  { write: true }
);
