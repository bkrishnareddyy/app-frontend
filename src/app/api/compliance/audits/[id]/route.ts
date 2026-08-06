import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

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
  } catch (error) {
    console.error("GET /api/compliance/audits/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
