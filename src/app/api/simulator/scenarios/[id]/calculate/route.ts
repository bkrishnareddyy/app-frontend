import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const scenario = await db.landedCostScenario.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      lineItems: {
        include: { htsCode: true },
      },
    },
  });

  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  const lineCalculations = scenario.lineItems.map((item) => {
    const customsValue = Number(item.unitValue) * Number(item.quantity);
    const hts = item.htsCode;
    const baseDutyRate = item.dutyRateOverride !== null && item.dutyRateOverride !== undefined
      ? Number(item.dutyRateOverride) / 100
      : parseFloat(hts.generalDutyRate.replace("%", "")) / 100 || 0.028;

    const sec301Rate = hts.section301Applicable ? (Number(hts.section301AdditionalRate) || 0) / 100 : 0.0;
    const sec232Rate = hts.section232Applicable ? (Number(hts.section232AdditionalRate) || 0) / 100 : 0.0;
    const effectiveRate = baseDutyRate + sec301Rate + sec232Rate;

    const duty = Math.round((customsValue * effectiveRate) * 100) / 100;
    const fees = Math.round((customsValue * 0.003464 + customsValue * 0.00125) * 100) / 100;
    const landedCost = customsValue + (item.freightCost ? Number(item.freightCost) : 0) + (item.insuranceCost ? Number(item.insuranceCost) : 0) + duty + fees;

    return {
      id: item.id,
      description: item.description,
      htsCode: hts.htsCode10,
      customsValue,
      baseDutyRate: `${(baseDutyRate * 100).toFixed(1)}%`,
      section301Rate: `${(sec301Rate * 100).toFixed(1)}%`,
      section232Rate: `${(sec232Rate * 100).toFixed(1)}%`,
      totalEffectiveDutyRate: `${(effectiveRate * 100).toFixed(1)}%`,
      duty,
      fees,
      landedCost,
    };
  });

  const totalCustomsValue = lineCalculations.reduce((sum, l) => sum + l.customsValue, 0);
  const totalDuty = lineCalculations.reduce((sum, l) => sum + l.duty, 0);
  const totalFees = lineCalculations.reduce((sum, l) => sum + l.fees, 0);
  const totalLandedCost = lineCalculations.reduce((sum, l) => sum + l.landedCost, 0);

  return NextResponse.json({
    calculation: {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      originCountry: scenario.originCountry,
      destinationPort: scenario.destinationPort,
      totalCustomsValue,
      totalDuty,
      totalFees,
      totalLandedCost,
      effectiveLandedMultiplier: totalCustomsValue > 0 ? (totalLandedCost / totalCustomsValue).toFixed(4) : "1.0000",
      lineCalculations,
    },
  });
});
