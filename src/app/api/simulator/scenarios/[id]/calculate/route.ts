import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { calculateMPF, calculateHMF } from "@/lib/tariff/dutyEngine";
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

    let baseDutyRate: number | null = null;
    if (item.dutyRateOverride !== null && item.dutyRateOverride !== undefined) {
      baseDutyRate = Number(item.dutyRateOverride) / 100;
    } else {
      const parsed = parseFloat((hts.generalDutyRate ?? "").replace("%", ""));
      // A genuine 0% stays 0; only an unparseable rate is unknown.
      if (!isNaN(parsed)) baseDutyRate = parsed / 100;
    }

    const sec301Rate = hts.section301Applicable ? (Number(hts.section301AdditionalRate) || 0) / 100 : 0.0;
    const sec232Rate = hts.section232Applicable ? (Number(hts.section232AdditionalRate) || 0) / 100 : 0.0;
    const effectiveRate = baseDutyRate === null ? null : baseDutyRate + sec301Rate + sec232Rate;
    const duty = effectiveRate === null ? null : Math.round(customsValue * effectiveRate * 100) / 100;

    return {
      id: item.id,
      description: item.description,
      htsCode: hts.htsCode10,
      customsValue,
      baseDutyRate: baseDutyRate === null ? null : `${(baseDutyRate * 100).toFixed(1)}%`,
      section301Rate: `${(sec301Rate * 100).toFixed(1)}%`,
      section232Rate: `${(sec232Rate * 100).toFixed(1)}%`,
      totalEffectiveDutyRate: effectiveRate === null ? null : `${(effectiveRate * 100).toFixed(1)}%`,
      duty,
      freightCost: item.freightCost ? Number(item.freightCost) : 0,
      insuranceCost: item.insuranceCost ? Number(item.insuranceCost) : 0,
    };
  });

  const totalCustomsValue = lineCalculations.reduce((sum, l) => sum + l.customsValue, 0);

  // MPF and HMF are per-entry fees, and MPF is clamped to a statutory floor and
  // ceiling. Computing them per line and summing would multiply both bounds.
  const mpfAmount = calculateMPF(totalCustomsValue);
  const hmfAmount = calculateHMF(totalCustomsValue, true);
  const totalFees = Math.round((mpfAmount + hmfAmount) * 100) / 100;

  const unratedLines = lineCalculations.filter((l) => l.duty === null).length;
  const totalDuty = unratedLines > 0
    ? null
    : Math.round(lineCalculations.reduce((sum, l) => sum + (l.duty ?? 0), 0) * 100) / 100;

  const totalFreightAndInsurance = lineCalculations.reduce(
    (sum, l) => sum + l.freightCost + l.insuranceCost,
    0
  );
  const totalLandedCost = totalDuty === null
    ? null
    : Math.round((totalCustomsValue + totalFreightAndInsurance + totalDuty + totalFees) * 100) / 100;

  return NextResponse.json({
    calculation: {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      originCountry: scenario.originCountry,
      destinationPort: scenario.destinationPort,
      totalCustomsValue,
      totalDuty,
      totalFees,
      feeBreakdown: { mpfAmount, hmfAmount },
      totalLandedCost,
      unratedLineCount: unratedLines,
      effectiveLandedMultiplier:
        totalLandedCost !== null && totalCustomsValue > 0
          ? (totalLandedCost / totalCustomsValue).toFixed(4)
          : null,
      lineCalculations,
    },
  });
}, { write: true });
