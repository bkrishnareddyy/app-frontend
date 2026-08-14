import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json().catch(() => ({}));
  const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId : undefined;

  const scenario = await db.landedCostScenario.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  const updatedScenario = await db.landedCostScenario.update({
    where: { id },
    data: { status: "Approved" },
  });

  let linkedShipment = null;
  if (shipmentId) {
    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, accountId: ctx.accountId },
    });

    if (shipment) {
      linkedShipment = await db.shipment.update({
        where: { id: shipmentId },
        data: { scenarioId: id },
      });
    }
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "simulator.scenario_approve",
    entity: "LandedCostScenario",
    entityId: id,
    source: "UI",
    metadata: { shipmentId: shipmentId || null },
  });

  return NextResponse.json({
    success: true,
    scenario: updatedScenario,
    shipment: linkedShipment,
  });

}, { permission: "intel.read", write: true });
