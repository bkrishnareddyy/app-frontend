import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { evaluateReasonableCare } from "@/modules/compliance/reasonableCare";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { filingId } = body;

  let filing = null;
  if (filingId) {
    filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId: ctx.accountId },
      include: {
        shipment: {
          include: { documents: true, lineItems: true },
        },
      },
    });
  } else {
    filing = await db.customsFiling.findFirst({
      where: { accountId: ctx.accountId },
      include: {
        shipment: {
          include: { documents: true, lineItems: true },
        },
      },
    });
  }

  if (!filing) {
    return NextResponse.json({ error: "No customs filing found to audit" }, { status: 404 });
  }

  const lineItems = filing.shipment.lineItems || [];
  const documents = filing.shipment.documents || [];

  const auditLogCount = await db.auditLog.count({
    where: { accountId: ctx.accountId, entityId: filing.id },
  });

  const { checklistItems, overallResult, riskScore } = evaluateReasonableCare({
    lineItems: lineItems.map((l) => ({
      htsCode: l.htsCode,
      countryOfOrigin: l.countryOfOrigin,
    })),
    documents: documents.map((d) => ({ status: d.status })),
    totalValue: filing.totalValue === null ? null : Number(filing.totalValue),
    auditLogCount,
  });

  const auditRecord = await db.complianceAuditRecord.create({
    data: {
      accountId: ctx.accountId,
      filingId: filing.id,
      auditType: "reasonable_care_checklist",
      overallResult,
      checklistItems: checklistItems as unknown as Prisma.InputJsonValue,
      riskScore,
      runByAgentName: "Qubere Compliance Audit Agent",
    },
    include: { filing: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "compliance_audit.run",
    entity: "ComplianceAuditRecord",
    entityId: auditRecord.id,
    metadata: { filingId: filing.id, overallResult, riskScore },
  });

  return NextResponse.json({ auditRecord }, { status: 201 });
}, { write: true });
