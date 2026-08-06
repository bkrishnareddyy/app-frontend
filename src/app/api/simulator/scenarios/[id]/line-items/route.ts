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
    const body = await req.json();
    const { description, htsCode10, unitValue, quantity, freightCost, insuranceCost, dutyRateOverride } = body;

    const scenario = await db.landedCostScenario.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    let hts = await db.hTSCode.findFirst({
      where: { htsCode10: htsCode10 || "8481.80.5090" },
    });

    if (!hts) {
      hts = await db.hTSCode.create({
        data: {
          htsCode10: htsCode10 || "8481.80.5090",
          description: description || "Default Valve Appliance",
          chapterNumber: "84",
          headingNumber: "8481",
          subheadingNumber: "8481.80",
          generalDutyRate: "2.8%",
        },
      });
    }

    // Calculate duty and landed cost
    const baseDutyRate = dutyRateOverride !== undefined
      ? dutyRateOverride / 100
      : parseFloat(hts.generalDutyRate.replace("%", "")) / 100 || 0.028;

    const section301Rate = hts.section301Applicable ? (hts.section301AdditionalRate || 0) / 100 : 0.0;
    const section232Rate = hts.section232Applicable ? (hts.section232AdditionalRate || 0) / 100 : 0.0;

    const totalDutyRate = baseDutyRate + section301Rate + section232Rate;
    const totalCustomsValue = (unitValue || 100) * (quantity || 1);
    const computedDuty = Math.round((totalCustomsValue * totalDutyRate) * 100) / 100;
    const computedFees = Math.round((totalCustomsValue * 0.003464 + totalCustomsValue * 0.00125) * 100) / 100; // MPF + HMF
    const computedLandedCost = totalCustomsValue + (freightCost || 0) + (insuranceCost || 0) + computedDuty + computedFees;

    const lineItem = await db.landedCostScenarioLineItem.create({
      data: {
        scenarioId: id,
        description: description || hts.description,
        htsCodeId: hts.id,
        unitValue: unitValue || 100,
        quantity: quantity || 1,
        freightCost: freightCost || 0.0,
        insuranceCost: insuranceCost || 0.0,
        dutyRateOverride,
        computedDuty,
        computedFees,
        computedLandedCost,
      },
      include: { htsCode: true },
    });

    return NextResponse.json({ lineItem }, { status: 201 });
  } catch (error) {
    console.error("POST /api/simulator/scenarios/[id]/line-items error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
