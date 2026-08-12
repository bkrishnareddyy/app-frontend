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

  // RegulatoryUpdate is shared reference data and carries no accountId; the impact
  // rows are only readable through the caller's own shipments.
  const regUpdate = await db.regulatoryUpdate.findUnique({ where: { id } });

  if (!regUpdate) {
    return NextResponse.json({ error: "Regulatory update not found" }, { status: 404 });
  }

  const impacts = await db.regulatoryUpdateImpact.findMany({
    where: {
      regulatoryUpdateId: id,
      shipment: { accountId: ctx.accountId, deletedAt: null },
    },
    // filingDeadline is in the Prisma schema but not yet applied to the live
    // DB (migration pending) -- must stay omitted or this 500s.
    include: { shipment: { omit: { filingDeadline: true } } },
    orderBy: { createdAt: "desc" },
  });

  const impactedShipments = impacts.map((imp) => ({
    impactId: imp.id,
    impactDescription: imp.impactDescription,
    shipment: imp.shipment,
  }));

  return NextResponse.json({
    regulatoryUpdate: regUpdate,
    affectedShipmentsCount: impactedShipments.length,
    impactedShipments,
  });
});
