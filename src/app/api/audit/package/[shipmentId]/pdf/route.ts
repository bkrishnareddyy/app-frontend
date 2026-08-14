import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";
import { generateReasonableCarePdfHtml } from "@/lib/audit/pdfExport";

export const GET = withAuthenticatedRoute<{ shipmentId: string }>(async ({ params }) => {
  const { shipmentId } = params;

  const pkg = await assembleReasonableCarePackage(shipmentId);
  if (!pkg) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  const html = generateReasonableCarePdfHtml(pkg);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="reasonable-care-${shipmentId}.html"`,
    },
  });
});
