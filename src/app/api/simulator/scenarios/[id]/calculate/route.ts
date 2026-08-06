import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

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
      const customsValue = item.unitValue * item.quantity;
      const hts = item.htsCode;
      const baseDutyRate = item.dutyRateOverride !== null && item.dutyRateOverride !== undefined
        ? item.dutyRateOverride / 100
        : parseFloat(hts.generalDutyRate.replace("%", "")) / 100 || 0.028;

      const sec301Rate = hts.section301Applicable ? (hts.section301AdditionalRate || 0) / 100 : 0.0;
      const sec232Rate = hts.section232Applicable ? (hts.section232AdditionalRate || 0) / 100 : 0.0;
      const effectiveRate = baseDutyRate + sec301Rate + sec232Rate;

      const duty = Math.round((customsValue * effectiveRate) * 100) / 100;
      const fees = Math.round((customsValue * 0.003464 + customsValue * 0.00125) * 100) / 100;
      const landedCost = customsValue + item.freightCost + item.insuranceCost + duty + fees;

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
  } catch (error) {
    console.error("POST /api/simulator/scenarios/[id]/calculate error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
