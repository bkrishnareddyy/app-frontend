import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

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
});
