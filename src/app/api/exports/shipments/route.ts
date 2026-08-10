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

  const exportShipment = await db.exportShipment.create({
    data: {
      accountId: ctx.accountId,
      exportShipmentNumber: num,
      exporterName: exporterName || "Global Exporters LLC",
      destinationCountry: destinationCountry || "Japan",
      status: "Exported",
      lineItems: {
        create: lineItems || [
          {
            accountId: ctx.accountId,
            partNumber: "VALVE-316-NPT",
            description: "Exported Stainless Steel Valve 1/2 NPT",
            quantity: 200,
            htsCode: "8481.80.5090",
            unitValue: 250.0,
          },
        ],
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
    metadata: { exportShipmentNumber: num },
  });

  return NextResponse.json({ exportShipment }, { status: 201 });
}, { write: true });
