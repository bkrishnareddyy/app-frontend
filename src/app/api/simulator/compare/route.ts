import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { scenarioIds } = body;

  if (!Array.isArray(scenarioIds) || scenarioIds.length === 0) {
    return NextResponse.json({ error: "scenarioIds array is required" }, { status: 400 });
  }

  const scenarios = await db.landedCostScenario.findMany({
    where: {
      id: { in: scenarioIds },
      accountId: ctx.accountId,
    },
    include: {
      lineItems: {
        include: { htsCode: true },
      },
    },
  });

  const comparisons = scenarios.map((s) => {
    const totalCustomsValue = s.lineItems.reduce((acc, l) => acc + Number(l.unitValue) * Number(l.quantity), 0);
    const totalDuty = s.lineItems.reduce((acc, l) => acc + Number(l.computedDuty), 0);
    const totalFees = s.lineItems.reduce((acc, l) => acc + Number(l.computedFees), 0);
    const totalLandedCost = s.lineItems.reduce((acc, l) => acc + (Number(l.computedLandedCost) || (Number(l.unitValue) * Number(l.quantity) + Number(l.computedDuty) + Number(l.computedFees))), 0);

    return {
      scenarioId: s.id,
      name: s.name,
      originCountry: s.originCountry,
      destinationPort: s.destinationPort,
      incoterm: s.incoterm,
      totalCustomsValue,
      totalDuty,
      totalFees,
      totalLandedCost,
      dutyRatioPct: totalCustomsValue > 0 ? ((totalDuty / totalCustomsValue) * 100).toFixed(2) : "0.00",
    };
  });

  return NextResponse.json({ comparisons });
});
