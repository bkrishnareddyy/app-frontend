import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { status, notes } = body;

  const finding = await db.complianceFinding.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!finding) {
    return NextResponse.json({ error: "Compliance finding not found" }, { status: 404 });
  }

  const newStatus = status || "Resolved";

  const updatedFinding = await db.complianceFinding.update({
    where: { id },
    data: {
      status: newStatus,
      resolvedAt: newStatus === "Resolved" || newStatus === "AcceptedRisk" ? new Date() : null,
    },
  });

  // Write event to immutable audit timeline
  await db.auditTimeline.create({
    data: {
      accountId: ctx.accountId,
      filingId: finding.filingId,
      event: `Compliance Finding Resolved: ${finding.rule} (${newStatus})`,
      actor: `Compliance Analyst (${ctx.userId})`,
      metadata: { findingId: id, status: newStatus, notes },
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "finding.resolve",
    entity: "ComplianceFinding",
    entityId: id,
    metadata: { newStatus, notes },
  });

  return NextResponse.json({ finding: updatedFinding });
});
