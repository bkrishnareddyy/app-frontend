import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";
import { assembleFocusedAssessmentFile } from "@/lib/audit/focusedAssessment";
import { generateSimplePdfBuffer } from "@/lib/pdf/pdfGenerator";
import { generateForm7501PdfBuffer } from "@/lib/filing/form7501Pdf";
import { buildForm7501, type FilingHeaderInput, type LineItemInput } from "@/lib/filing/form7501";
import { generateZipBuffer } from "@/lib/zip/zipGenerator";

export const GET = withAuthenticatedRoute<{ filingId: string }>(async ({ req, ctx, params }) => {
  const { filingId } = params;

  const filing = await db.customsFiling.findFirst({
    where: { id: filingId, accountId: ctx.accountId },
    include: {
      shipment: { include: { lineItems: true, documents: true } },
      importerOfRecord: true,
      bond: true,
      responses: true,
    },
  });

  if (!filing) {
    return NextResponse.json({ error: "Customs filing not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "FOCUSED_ASSESSMENT_ACCESSED",
    entity: "CustomsFiling",
    entityId: filingId,
    source: "UI",
    metadata: { entryNumber: filing.entryNumber, format: format || "json" },
  });

  // Assemble Focused Assessment File
  const periodFrom = new Date(filing.createdAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const periodTo = new Date(filing.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const faFile = await assembleFocusedAssessmentFile(ctx.accountId, {
    periodFrom,
    periodTo,
    entryIds: [filingId],
  });

  // Assemble Reasonable Care Package if shipment exists
  const rcPackage = filing.shipmentId
    ? await assembleReasonableCarePackage(ctx.accountId, filing.shipmentId)
    : null;

  // Build Form 7501
  const lineItemInputs: LineItemInput[] = (filing.shipment?.lineItems ?? []).map((li) => ({
    id: li.id,
    lineNumber: li.lineNumber,
    description: li.description,
    htsCode: li.htsCode,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unitPrice),
    totalValue: Number(li.totalValue),
    countryOfOrigin: li.countryOfOrigin,
  }));

  const filingHeaderInput: FilingHeaderInput = {
    id: filing.id,
    entryNumber: filing.entryNumber,
    entryType: filing.entryType,
    importerName: filing.importerOfRecord?.name ?? filing.shipment?.importerName ?? "Unknown Importer",
    importerCbpNumber: filing.importerOfRecord?.cbpImporterNumber ?? null,
    importerOfRecordId: filing.importerOfRecordId ?? null,
    bondNumber: filing.bond?.bondNumber ?? null,
    bondId: filing.bondId ?? null,
    portOfEntry: filing.shipment?.portOfEntry ?? null,
    countryOfExport: filing.shipment?.countryOfExport ?? null,
    carrierName: filing.shipment?.carrierName ?? null,
  };

  const form7501 = buildForm7501(filingHeaderInput, lineItemInputs, null);
  const pdf7501Buffer = generateForm7501PdfBuffer(form7501);

  // Generate Focused Assessment PDF
  const faPdfBuffer = generateSimplePdfBuffer({
    title: "CBP Focused Assessment Audit Defense File",
    subtitle: `Audit ID: ${faFile.auditId} | Entry: ${filing.entryNumber}`,
    metadata: {
      "Importer": faFile.importer.name || "N/A",
      "CBP Number": faFile.importer.cbpNumber || "N/A",
      "Coverage Period": `${faFile.periodCovered.from.slice(0, 10)} to ${faFile.periodCovered.to.slice(0, 10)}`,
      "Audited Entries": String(faFile.entryPopulation.total),
      "Total Duty Audited": `$${faFile.entryPopulation.totalDutyPaid.toFixed(2)}`,
    },
    sections: [
      {
        heading: "Internal Controls Inventory",
        items: faFile.controlsInventory.map((c) => ({
          label: `${c.name} (${c.category})`,
          value: c.description || "Active internal control",
        })),
      },
      {
        heading: "Remediation Narrative",
        items: [
          { label: "Summary", value: faFile.remediationNarrative },
        ],
      },
    ],
  });

  if (format === "pdf") {
    return new Response(new Uint8Array(faPdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="focused-assessment-${filing.entryNumber}.pdf"`,
      },
    });
  }

  if (format === "zip") {
    const zipEntries = [
      { filename: `Focused_Assessment_Defense_Report.pdf`, content: faPdfBuffer },
      { filename: `CBP_Form_7501_${filing.entryNumber}.pdf`, content: pdf7501Buffer },
      { filename: `audit_binder_manifest.json`, content: JSON.stringify({ filingId, entryNumber: filing.entryNumber, focusedAssessment: faFile, reasonableCarePackage: rcPackage }, null, 2) },
    ];

    if (rcPackage) {
      const rcPdfBuffer = generateSimplePdfBuffer({
        title: "CBP Reasonable Care Compliance Record",
        subtitle: `Entry Ref: ${filing.entryNumber}`,
        metadata: {
          "Shipment ID": filing.shipmentId!,
          "Importer of Record": rcPackage.importerOfRecord.name || "Unknown",
          "Assembly Date": rcPackage.generatedAt,
          "Overall Compliance Score": `${rcPackage.completenessScore}%`,
        },
        sections: [
          {
            heading: "Line Item Tariff Classifications",
            items: rcPackage.sections.classification.map((item) => ({
              label: `Line #${item.lineItemNumber} (${item.htsCode || "Unclassified"})`,
              value: `${item.description || "Line Item"} - Approver: ${item.approver || "System"}`,
            })),
          },
        ],
      });
      zipEntries.push({ filename: `Reasonable_Care_Record.pdf`, content: rcPdfBuffer });
    }

    const zipBuffer = generateZipBuffer(zipEntries);

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="audit-room-binder-${filing.entryNumber}.zip"`,
      },
    });
  }

  return NextResponse.json({
    filingId,
    entryNumber: filing.entryNumber,
    reasonableCarePackage: rcPackage,
    focusedAssessment: faFile,
  });
});
