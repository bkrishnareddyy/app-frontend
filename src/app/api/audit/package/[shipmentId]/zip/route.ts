import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";
import { generateSimplePdfBuffer } from "@/lib/pdf/pdfGenerator";
import { generateForm7501PdfBuffer } from "@/lib/filing/form7501Pdf";
import { buildForm7501, type FilingHeaderInput, type LineItemInput } from "@/lib/filing/form7501";
import { generateZipBuffer } from "@/lib/zip/zipGenerator";

export const GET = withAuthenticatedRoute<{ shipmentId: string }>(async ({ ctx, params }) => {
  const { shipmentId } = params;

  const pkg = await assembleReasonableCarePackage(ctx.accountId, shipmentId);
  if (!pkg) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  const p = pkg as any;
  const rcPdfBuffer = generateSimplePdfBuffer({
    title: "CBP Reasonable Care Compliance Record",
    subtitle: `Entry Ref: ${p.entryNumber || shipmentId}`,
    metadata: {
      "Shipment ID": shipmentId,
      "Importer of Record": p.importerOfRecord?.name || "Unknown",
      "Assembly Date": p.generatedAt || new Date().toISOString(),
      "Overall Compliance Score": `${p.completenessScore ?? 100}%`,
    },
    sections: [
      {
        heading: "Line Item Tariff Classifications",
        items: (p.sections?.classification || []).map((item: any) => ({
          label: `Line #${item.lineItemNumber} (${item.htsCode || "Unclassified"})`,
          value: `${item.description || "Line Item"} - Approver: ${item.approver || "System"}`,
        })),
      },
      {
        heading: "Valuation & Assists",
        items: [
          { label: "Declared Customs Value", value: `$${p.sections?.valuation?.declaredCustomsValue ?? 0}` },
          { label: "Assists Total", value: p.sections?.valuation?.assistsTotal != null ? `$${p.sections.valuation.assistsTotal}` : "None" },
          { label: "Related Party Transaction", value: p.sections?.valuation?.relatedPartyFlag ? "Yes" : "No" },
        ],
      },
      {
        heading: "Compliance Exceptions",
        items: (p.sections?.exceptions || []).slice(0, 5).map((ex: any) => ({
          label: `${ex.category || "EXCEPTION"} (${ex.severity || "Medium"})`,
          value: `${ex.description || "Exception logged"} - Status: ${ex.status || "Open"}`,
        })),
      },
    ],
  });

  const zipEntries = [
    { filename: `reasonable-care-${p.entryNumber || shipmentId}.pdf`, content: rcPdfBuffer },
    { filename: `reasonable-care-${p.entryNumber || shipmentId}-data.json`, content: JSON.stringify(pkg, null, 2) },
  ];

  // If a customs filing exists for this shipment, include Form 7501 PDF as well
  const filing = await db.customsFiling.findFirst({
    where: { shipmentId, accountId: ctx.accountId },
    include: { shipment: { include: { lineItems: true } }, importerOfRecord: true, bond: true },
  });

  if (filing && filing.shipment) {
    const lineItemInputs: LineItemInput[] = filing.shipment.lineItems.map((li) => ({
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
      importerName: filing.importerOfRecord?.name ?? filing.shipment.importerName ?? "Unknown Importer",
      importerCbpNumber: filing.importerOfRecord?.cbpImporterNumber ?? null,
      importerOfRecordId: filing.importerOfRecordId ?? null,
      bondNumber: filing.bond?.bondNumber ?? null,
      bondId: filing.bondId ?? null,
      portOfEntry: filing.shipment.portOfEntry ?? null,
      countryOfExport: filing.shipment.countryOfExport ?? null,
      carrierName: filing.shipment.carrierName ?? null,
    };

    const form7501 = buildForm7501(filingHeaderInput, lineItemInputs, null);
    const pdf7501Buffer = generateForm7501PdfBuffer(form7501);
    zipEntries.push({ filename: `7501-${filing.entryNumber}.pdf`, content: pdf7501Buffer });
  }

  const zipBuffer = generateZipBuffer(zipEntries);

  return new Response(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="reasonable-care-${p.entryNumber || shipmentId}-package.zip"`,
    },
  });
});
