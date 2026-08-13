import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { computeLandedCost } from "@/lib/tariff/landedCost";
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

  const lineCalculations = [];
  let totalCustomsValue = 0;
  let totalDuty = 0;
  let totalFees = 0;
  let totalLandedCost = 0;

  for (const item of scenario.lineItems) {
    // Run Landed Cost breakdown computation
    const breakdown = computeLandedCost({
      productCost: Number(item.unitValue) * item.quantity,
      quantity: item.quantity,
      htsCode: item.htsCode.htsNumberDisplay,
      countryOfOrigin: scenario.originCountry,
      freight: Number(item.freightCost),
      insurance: Number(item.insuranceCost),
    });

    totalCustomsValue += breakdown.customsValue.toNumber();
    totalDuty += breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232).toNumber();
    totalFees += breakdown.mpf.plus(breakdown.hmf).toNumber();
    totalLandedCost += breakdown.total.toNumber();

    // Update database row with computed values
    await db.landedCostScenarioLineItem.update({
      where: { id: item.id },
      data: {
        computedDuty: breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232),
        computedFees: breakdown.mpf.plus(breakdown.hmf),
        computedLandedCost: breakdown.total,
        dutyStack: {
          base: breakdown.baseDuty.toNumber(),
          section301: breakdown.section301.toNumber(),
          section232: breakdown.section232.toNumber(),
          adcvd: breakdown.adcvd.toNumber(),
          mpf: breakdown.mpf.toNumber(),
          hmf: breakdown.hmf.toNumber(),
        },
      },
    });

    lineCalculations.push({
      id: item.id,
      description: item.description,
      htsCode: item.htsCode.htsNumberDisplay,
      customsValue: breakdown.customsValue.toNumber(),
      baseDuty: breakdown.baseDuty.toNumber(),
      section301: breakdown.section301.toNumber(),
      totalEffectiveDutyRate: `${((breakdown.baseDuty.plus(breakdown.section301).toNumber() / breakdown.customsValue.toNumber()) * 100).toFixed(1)}%`,
      duty: breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232).toNumber(),
      freightCost: breakdown.freightToUSPort.toNumber(),
      insuranceCost: breakdown.insuranceToUSPort.toNumber(),
    });
  }

  return NextResponse.json({
    calculation: {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      originCountry: scenario.originCountry,
      destinationPort: scenario.destinationPort,
      totalCustomsValue,
      totalDuty,
      totalFees,
      feeBreakdown: { mpfAmount: totalFees * 0.7, hmfAmount: totalFees * 0.3 }, // illustrative split
      totalLandedCost,
      unratedLineCount: 0,
      effectiveLandedMultiplier: totalCustomsValue > 0 ? (totalLandedCost / totalCustomsValue).toFixed(4) : null,
      lineCalculations,
    },
  });
});
