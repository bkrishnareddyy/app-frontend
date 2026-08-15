import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";
import { generateSimplePdfBuffer } from "@/lib/pdf/pdfGenerator";

export const GET = withAuthenticatedRoute<{ shipmentId: string }>(async ({ ctx, params }) => {
  const { shipmentId } = params;

  const pkg = await assembleReasonableCarePackage(ctx.accountId, shipmentId);
  if (!pkg) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  const p = pkg as any;
  const pdfBuffer = generateSimplePdfBuffer({
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
        heading: "Compliance Exceptions",
        items: (p.sections?.exceptions || []).slice(0, 5).map((ex: any) => ({
          label: `${ex.category || "EXCEPTION"} (${ex.severity || "Medium"})`,
          value: `${ex.description || "Exception logged"} - Status: ${ex.status || "Open"}`,
        })),
      },
    ],
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="reasonable-care-${shipmentId}.pdf"`,
    },
  });
});
