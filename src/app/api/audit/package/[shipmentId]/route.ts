import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";

export const GET = withAuthenticatedRoute<{ shipmentId: string }>(async ({ ctx, params }) => {
  const { shipmentId } = params;

  const pkg = await assembleReasonableCarePackage(ctx.accountId, shipmentId);
  if (!pkg) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  return NextResponse.json({
    shipmentId,
    completenessScore: pkg.completenessScore,
    auditPackage: pkg,
  });
});
