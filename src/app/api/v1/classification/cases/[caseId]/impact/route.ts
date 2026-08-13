import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { Decimal } from "@/lib/tariff/decimal";
import { z } from "zod";

const paramsSchema = z.object({ caseId: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ caseId: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  try {
    const decision = await db.classificationDecision.findFirst({
      where: { caseId: paramsVal.data.caseId, case: { accountId: ctx.accountId } },
      orderBy: { attestedAt: "desc" },
      select: { id: true, approvedNode: { select: { htsNumberDisplay: true } } },
    });

    if (!decision) {
      return NextResponse.json({ impacts: [], summary: { shipmentCount: 0, filingCount: 0, dutyDelta: "0.00" } });
    }

    const impacts = await db.classificationChangeImpact.findMany({
      where: { classificationDecisionId: decision.id, accountId: ctx.accountId },
      include: {
        shipment: { select: { id: true, shipmentNumber: true } },
        filing: { select: { id: true, filingStatus: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const uniqueShipments = new Set(impacts.map((i) => i.shipmentId));
    const uniqueFilings = new Set(impacts.filter((i) => i.filingId).map((i) => i.filingId));
    const totalDutyDeltaDec = impacts.reduce((sum, i) => sum.plus(new Decimal(i.dutyImpact ? String(i.dutyImpact) : 0)), new Decimal(0));

    return NextResponse.json({
      impacts,
      summary: {
        shipmentCount: uniqueShipments.size,
        filingCount: uniqueFilings.size,
        dutyDelta: totalDutyDeltaDec.toFixed(2),
      },
    });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
