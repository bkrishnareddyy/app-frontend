import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const finding = await db.complianceScreeningFinding.findFirst({
    where: { id, accountId: ctx.accountId },
  });
  if (!finding) {
    return NextResponse.json({ error: "Compliance screening finding not found", requestId }, { status: 404 });
  }

  const updated = await db.complianceScreeningFinding.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "compliance_screening_finding.resolve",
    entity: "ComplianceScreeningFinding",
    entityId: id,
    source: "UI",
    metadata: { category: finding.category, ruleId: finding.ruleId },
  });

  return NextResponse.json({ success: true, finding: updated, requestId });
}, { permission: "exceptions.resolve", write: true });
