import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const policies = await db.agentPolicyConfig.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { agentName: "asc" },
  });

  // Fetch audit log for policy history
  const history = await db.auditLog.findMany({
    where: {
      accountId: ctx.accountId,
      entity: "AgentPolicyConfig",
      action: { in: ["AGENT_POLICY_CREATED", "AGENT_POLICY_UPDATED"] },
    },
    include: { user: { select: { email: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    policies: policies.map((p) => ({
      id: p.id,
      agentName: p.agentName,
      autoThreshold: p.autoThreshold,
      confirmThreshold: p.confirmThreshold,
      requirePartMasterMatch: p.requirePartMasterMatch,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    history: history.map((h) => ({
      id: h.id,
      action: h.action,
      metadata: h.metadata,
      changedBy: h.user
        ? `${h.user.firstName ?? ""} ${h.user.lastName ?? ""}`.trim() || h.user.email
        : "System",
      createdAt: h.createdAt.toISOString(),
    })),
    requestId,
  });
});

const upsertPolicySchema = z.object({
  agentName: z.string().min(1).max(100),
  autoThreshold: z.number().int().min(0).max(100).optional(),
  confirmThreshold: z.number().int().min(0).max(100).optional(),
  requirePartMasterMatch: z.boolean().optional(),
}).refine(
  (d) => {
    if (d.autoThreshold !== undefined && d.confirmThreshold !== undefined) {
      return d.autoThreshold > d.confirmThreshold;
    }
    return true;
  },
  { message: "autoThreshold must be greater than confirmThreshold" }
);

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, upsertPolicySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { agentName, autoThreshold, confirmThreshold, requirePartMasterMatch } = bodyVal.data;

  const existing = await db.agentPolicyConfig.findFirst({
    where: { accountId: ctx.accountId, agentName },
});

  const data: Parameters<typeof db.agentPolicyConfig.create>[0]["data"] = {
    accountId: ctx.accountId,
    agentName,
    ...(autoThreshold !== undefined && { autoThreshold }),
    ...(confirmThreshold !== undefined && { confirmThreshold }),
    ...(requirePartMasterMatch !== undefined && { requirePartMasterMatch }),
  };

  let policy;
  if (existing) {
    policy = await db.agentPolicyConfig.update({
      where: { id: existing.id },
      data,
    });
  } else {
    policy = await db.agentPolicyConfig.create({ data });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: existing ? "AGENT_POLICY_UPDATED" : "AGENT_POLICY_CREATED",
    entity: "AgentPolicyConfig",
    entityId: policy.id,
    source: "UI",
    metadata: {
      agentName,
      autoThreshold: policy.autoThreshold,
      confirmThreshold: policy.confirmThreshold,
      requirePartMasterMatch: policy.requirePartMasterMatch,
      previousAutoThreshold: existing?.autoThreshold,
      previousConfirmThreshold: existing?.confirmThreshold,
    },
    success: true,
  });

  return NextResponse.json({
    success: true,
    policy: {
      id: policy.id,
      agentName: policy.agentName,
      autoThreshold: policy.autoThreshold,
      confirmThreshold: policy.confirmThreshold,
      requirePartMasterMatch: policy.requirePartMasterMatch,
      updatedAt: policy.updatedAt.toISOString(),
    },
    requestId,
  });

}, { permission: "settings.manage", write: true });
