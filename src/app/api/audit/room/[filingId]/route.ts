import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";
import { assembleFocusedAssessmentFile } from "@/lib/audit/focusedAssessment";

export const GET = withAuthenticatedRoute<{ filingId: string }>(async ({ ctx, params }) => {
  const { filingId } = params;

  const filing = await db.customsFiling.findFirst({
    where: { id: filingId, accountId: ctx.accountId },
    include: {
      shipment: { include: { lineItems: true, documents: true } },
      responses: true,
    },
  });

  if (!filing) {
    return NextResponse.json({ error: "Customs filing not found" }, { status: 404 });
  }

  // Check if this is a standalone filing (no shipment)
  const isStandalone = !filing.shipmentId;
  
  if (isStandalone) {
    // For standalone filings, generate a simplified audit package
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "FOCUSED_ASSESSMENT_ACCESSED",
      entity: "CustomsFiling",
      entityId: filingId,
      source: "UI",
      metadata: { 
        entryNumber: filing.entryNumber,
        standalone: true,
        localReferenceNumber: filing.localReferenceNumber,
      },
    });

    return NextResponse.json({
      filingId,
      entryNumber: filing.entryNumber,
      localReferenceNumber: filing.localReferenceNumber,
      reasonableCarePackage: {
        message: "Standalone filing - no shipment-based documentation available",
        filingDetails: {
          country: filing.country,
          procedureCode: filing.procedureCode,
          messageName: filing.messageName,
          filingType: filing.filingType,
          filingStatus: filing.filingStatus,
        },
      },
      focusedAssessment: {
        periodFrom: filing.createdAt.toISOString(),
        periodTo: new Date().toISOString(),
        entries: [
          {
            id: filing.id,
            entryNumber: filing.entryNumber,
            localReferenceNumber: filing.localReferenceNumber,
            status: filing.filingStatus,
          },
        ],
      },
    });
  }

  // Shipment-based filing - existing logic
  if (!filing.shipment) {
    return NextResponse.json({ error: "Shipment not found for this filing" }, { status: 400 });
  }

  // Get reasonable care package
  const rcPackage = await assembleReasonableCarePackage(ctx.accountId, filing.shipmentId!);

  // Generate Focused Assessment covering the filing's creation period
  const periodFrom = new Date(filing.createdAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodTo = new Date(filing.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const faFile = await assembleFocusedAssessmentFile(ctx.accountId, {
    periodFrom,
    periodTo,
    entryIds: [filingId],
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "FOCUSED_ASSESSMENT_ACCESSED",
    entity: "CustomsFiling",
    entityId: filingId,
    source: "UI",
    metadata: { entryNumber: filing.entryNumber },
  });

  return NextResponse.json({
    filingId,
    entryNumber: filing.entryNumber,
    reasonableCarePackage: rcPackage,
    focusedAssessment: faFile,
  });
});
