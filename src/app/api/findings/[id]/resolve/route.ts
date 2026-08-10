import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const FINDING_STATUSES = ["Open", "Investigating", "Resolved", "AcceptedRisk", "Closed"];

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { status, notes } = body;

  // An absent status used to default to "Resolved", so an empty body closed the
  // finding, and any string at all was written straight through.
  if (typeof status !== "string" || !FINDING_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of ${FINDING_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const finding = await db.complianceFinding.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!finding) {
    return NextResponse.json({ error: "Compliance finding not found" }, { status: 404 });
  }

  const newStatus = status;

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
      // Every transition used to be recorded as "Resolved", so moving a finding to
      // Investigating logged a resolution that had not happened.
      event: `Compliance Finding ${finding.status} -> ${newStatus}: ${finding.rule}`,
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
}, { write: true });
