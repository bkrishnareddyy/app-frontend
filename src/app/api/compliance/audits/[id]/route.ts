import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const auditRecord = await db.complianceAuditRecord.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      filing: {
        include: {
          shipment: {
            include: { documents: true, lineItems: true },
          },
          responses: true,
        },
      },
    },
  });

  if (!auditRecord) {
    return NextResponse.json({ error: "Compliance audit record not found" }, { status: 404 });
  }

  const defenseFile = {
    auditRecordId: auditRecord.id,
    title: "Reasonable Care Defense Audit File",
    generatedAt: auditRecord.runAt,
    auditor: auditRecord.runByAgentName,
    entryNumber: auditRecord.filing.entryNumber,
    importerName: auditRecord.filing.shipment.importerName,
    overallResult: auditRecord.overallResult,
    riskScore: auditRecord.riskScore,
    checklistItems: auditRecord.checklistItems,
    lineItemsVerifiedCount: auditRecord.filing.shipment.lineItems.length,
    documentsVerifiedCount: auditRecord.filing.shipment.documents.length,
    filing: auditRecord.filing,
  };

  return NextResponse.json({ auditRecord, defenseFile });
});
