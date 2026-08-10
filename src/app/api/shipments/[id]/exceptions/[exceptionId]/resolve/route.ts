import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { ShipmentEventBus } from "@/modules/events/shipmentEventBus";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
  exceptionId: z.string().min(1),
});

export const POST = withAuthenticatedRoute<{ id: string; exceptionId: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id, exceptionId } = paramsVal.data;

  try {
    const exception = await db.exceptionItem.findFirst({
      where: { id: exceptionId, shipmentId: id },
    });

    if (!exception) {
      return NextResponse.json({ error: "Exception item not found" }, { status: 404 });
    }

    await db.exceptionItem.update({
      where: { id: exceptionId },
      data: {
        status: "Resolved",
        resolvedAt: new Date(),
        resolvedBy: ctx.userId,
      },
    });

    await ShipmentEventBus.logEvent({
      shipmentId: id,
      eventType: "EXCEPTION_RESOLVED",
      payload: { exceptionId, code: exception.code, description: exception.description },
      triggeredBy: ctx.userId,
    });

    const canonicalState = await CanonicalShipmentService.getCanonicalState(id);
    return NextResponse.json({ success: true, canonicalState });
  } catch (err: unknown) {
    console.error("Failed to resolve exception:", err);
    // The internal message stays in the log rather than going back to the caller.
    return NextResponse.json({ error: "Failed to resolve exception" }, { status: 500 });
  }
});

