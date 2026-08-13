import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { assembleReasonableCarePackage } from "@/lib/audit/reasonableCarePackage";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentId } = body;

  if (!shipmentId) {
    return NextResponse.json({ error: "shipmentId is required" }, { status: 400 });
  }

  const pkg = await assembleReasonableCarePackage(shipmentId);
  if (!pkg) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "REASONABLE_CARE_GENERATED",
    entity: "Shipment",
    entityId: shipmentId,
    metadata: {
      completenessScore: pkg.completenessScore,
      entryNumber: pkg.entryNumber,
    },
  });

  return NextResponse.json({ auditPackage: pkg });
}, { permission: "documents.create", write: true });

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const shipmentId = searchParams.get("shipmentId");

  if (!shipmentId) {
    return NextResponse.json({ error: "shipmentId parameter is required" }, { status: 400 });
  }

  const pkg = await assembleReasonableCarePackage(shipmentId);
  if (!pkg) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  return NextResponse.json({ auditPackage: pkg });
}, { permission: "documents.read" });
