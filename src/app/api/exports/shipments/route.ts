import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const exportShipments = await db.exportShipment.findMany({
    where: { accountId: ctx.accountId },
    include: {
      documents: true,
      lineItems: true,
    },
    orderBy: { exportDate: "desc" },
  });

  return NextResponse.json({ exportShipments });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { exporterName, destinationCountry, lineItems } = body;

  const num = `EXP-2026-${Math.floor(100000 + Math.random() * 900000)}`;

  // lineItems comes straight from the request body -- force accountId on every
  // item rather than trusting whatever (if anything) the caller supplied,
  // so a crafted body can't create ExportLineItem rows tagged to another tenant.
  const sanitizedLineItems = Array.isArray(lineItems)
    ? lineItems.map((item) => ({ ...item, accountId: ctx.accountId }))
    : [
        {
          accountId: ctx.accountId,
          partNumber: "VALVE-316-NPT",
          description: "Exported Stainless Steel Valve 1/2 NPT",
          quantity: 200,
          htsCode: "8481.80.5090",
          unitValue: 250.0,
        },
      ];

  const exportShipment = await db.exportShipment.create({
    data: {
      accountId: ctx.accountId,
      exportShipmentNumber: num,
      exporterName: exporterName || "Global Exporters LLC",
      destinationCountry: destinationCountry || "Japan",
      status: "Exported",
      lineItems: {
        create: sanitizedLineItems,
      },
    },
    include: { lineItems: true, documents: true },
});

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "export.create",
    entity: "ExportShipment",
    entityId: exportShipment.id,
    source: "UI",
    metadata: { exportShipmentNumber: num },
  });

  return NextResponse.json({ exportShipment });

}, { permission: "shipments.create", write: true });
