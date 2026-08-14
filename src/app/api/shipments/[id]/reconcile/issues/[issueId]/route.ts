import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { buildErrorResponse } from "@/lib/api/error";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
});

const bodySchema = z.object({
  action: z.enum(["resolve", "ignore"]),
  // C-2: Which value was accepted, required for "resolve"
  resolution: z.enum(["ACCEPTED_A", "ACCEPTED_B", "BOTH_WRONG", "ACKNOWLEDGED"]).optional(),
  // Free-text note explaining the resolution decision
  note: z.string().max(1000).optional(),
});

export const POST = withAuthenticatedRoute<{ id: string; issueId: string }>(
  async ({ req, ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;
    const { id, issueId } = paramsVal.data;

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return buildErrorResponse(400, "INVALID_BODY", "Invalid request body", undefined, requestId);
    }

    const { action, resolution, note } = parsed.data;

    if (action === "resolve" && !resolution) {
      return buildErrorResponse(
        400,
        "RESOLUTION_REQUIRED",
        "A resolution value (ACCEPTED_A, ACCEPTED_B, BOTH_WRONG, or ACKNOWLEDGED) is required when resolving an issue.",
        undefined,
        requestId
      );
    }

    const issue = await db.reconciliationIssue.findFirst({
      where: { id: issueId, shipmentId: id, accountId: ctx.accountId },
    });

    if (!issue) {
      return buildErrorResponse(404, "NOT_FOUND", "Issue not found", undefined, requestId);
    }

    const newStatus = action === "ignore" ? "Ignored" : "Resolved";

    // Look up the resolver's display name for the audit trail.
    const resolverUser = await db.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true },
    });
    const resolverName = resolverUser
      ? [resolverUser.firstName, resolverUser.lastName].filter(Boolean).join(" ") || "Unknown"
      : "Unknown";

    await db.reconciliationIssue.update({
      where: { id: issueId },
      data: {
        status: newStatus,
        resolvedAt: new Date(),
        resolution: resolution ?? null,
        note: note?.trim() || null,
        resolvedByUserId: ctx.userId,
        resolvedByUserName: resolverName,
      },
    });

    // C-1: Resolve the paired ExceptionItem that was created during reconciliation.
    const exCode = `CONFLICT:${issue.field}`;
    const existingEx = await db.exceptionItem.findFirst({
      where: { shipmentId: id, accountId: ctx.accountId, code: exCode, status: { not: "Resolved" } },
      select: { id: true },
    });
    if (existingEx) {
      await db.exceptionItem.update({
        where: { id: existingEx.id },
        data: {
          status: "Resolved",
          resolvedAt: new Date(),
          resolvedBy: ctx.userId,
          resolvedByName: resolverName,
          resolutionNote: note?.trim() || `Issue ${action}d: ${resolution ?? "no resolution selected"}.`,
        },
      });
    }

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action:
        action === "ignore"
          ? AuditAction.RECONCILIATION_ISSUE_IGNORED
          : AuditAction.RECONCILIATION_ISSUE_RESOLVED,
      entity: "ReconciliationIssue",
      entityId: issueId,
      source: "UI",
      metadata: {
        shipmentId: id,
        field: issue.field,
        resolution: resolution ?? null,
        note: note?.trim() || null,
        previousStatus: issue.status,
        newStatus,
      },
    });

    return NextResponse.json({ resolved: true, status: newStatus, resolution: resolution ?? null });
  },
  { permission: "shipments.manage", write: true }
);
