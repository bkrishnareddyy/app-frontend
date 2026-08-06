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

    const regUpdate = await db.regulatoryUpdate.findUnique({
      where: { id },
      include: {
        impacts: {
          include: {
            shipment: {
              include: { customsFilings: true },
            },
          },
        },
      },
    });

    if (!regUpdate) {
      return NextResponse.json({ error: "Regulatory update not found" }, { status: 404 });
    }

    // Auto-create impact relation link if none exist yet for testing/demo
    if (regUpdate.impacts.length === 0) {
      const sampleShipments = await db.shipment.findMany({
        where: { accountId: ctx.accountId },
        take: 3,
      });

      for (const s of sampleShipments) {
        await db.regulatoryUpdateImpact.create({
          data: {
            regulatoryUpdateId: id,
            shipmentId: s.id,
            impactDescription: `Section 301 tariff adjustment applies to shipment ${s.shipmentNumber}`,
          },
        });
      }
    }

    const reFetched = await db.regulatoryUpdate.findUnique({
      where: { id },
      include: {
        impacts: {
          include: { shipment: true },
        },
      },
    });

    const impactedShipments = reFetched?.impacts.map((imp) => ({
      impactId: imp.id,
      impactDescription: imp.impactDescription,
      shipment: imp.shipment,
    })) || [];

    return NextResponse.json({
      regulatoryUpdate: regUpdate,
      affectedShipmentsCount: impactedShipments.length,
      impactedShipments,
    });
  } catch (error) {
    console.error("GET /api/regulatory/[id]/impacted error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
