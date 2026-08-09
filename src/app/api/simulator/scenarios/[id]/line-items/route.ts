import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { calculateMPF, calculateHMF } from "@/lib/tariff/dutyEngine";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { description, htsCode10, unitValue, quantity, freightCost, insuranceCost, dutyRateOverride } = body;

  if (typeof htsCode10 !== "string" || htsCode10.trim() === "") {
    return NextResponse.json(
      { error: "htsCode10 is required", code: "HTS_CODE_REQUIRED" },
      { status: 400 }
    );
  }
  if (typeof unitValue !== "number" || !Number.isFinite(unitValue) || unitValue < 0) {
    return NextResponse.json(
      { error: "unitValue must be a non-negative number", code: "UNIT_VALUE_REQUIRED" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json(
      { error: "quantity must be a positive integer", code: "QUANTITY_REQUIRED" },
      { status: 400 }
    );
  }
  // Both columns are non-null with a 0 default, so an omitted cost was
  // indistinguishable from a declared zero and the landed cost silently
  // excluded it. The caller has to say which it means; a real 0 stays 0.
  for (const [field, value] of [
    ["freightCost", freightCost],
    ["insuranceCost", insuranceCost],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return NextResponse.json(
        {
          error: `${field} must be a non-negative number; pass 0 to declare there is none`,
          code: "LANDED_COST_COMPONENT_REQUIRED",
        },
        { status: 400 }
      );
    }
  }


  const scenario = await db.landedCostScenario.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  const hts = await db.hTSCode.findFirst({
    where: { htsCode10: htsCode10.trim() },
  });

  // Never invent a tariff line in the HTS master to satisfy a request.
  if (!hts) {
    return NextResponse.json(
      { error: `HTS code ${htsCode10} not found in the tariff master`, code: "HTS_CODE_NOT_FOUND" },
      { status: 404 }
    );
  }

  let baseDutyRate: number | null = null;
  if (typeof dutyRateOverride === "number" && Number.isFinite(dutyRateOverride)) {
    baseDutyRate = dutyRateOverride / 100;
  } else {
    const parsed = parseFloat((hts.generalDutyRate ?? "").replace("%", ""));
    // A genuine 0% stays 0; only an unparseable rate is unknown.
    if (!isNaN(parsed)) baseDutyRate = parsed / 100;
  }

  if (baseDutyRate === null) {
    return NextResponse.json(
      {
        error: `HTS code ${htsCode10} has no usable general duty rate; supply dutyRateOverride`,
        code: "DUTY_RATE_UNAVAILABLE",
      },
      { status: 422 }
    );
  }

  const section301Rate = hts.section301Applicable ? (Number(hts.section301AdditionalRate) || 0) / 100 : 0.0;
  const section232Rate = hts.section232Applicable ? (Number(hts.section232AdditionalRate) || 0) / 100 : 0.0;

  const totalDutyRate = baseDutyRate + section301Rate + section232Rate;
  const totalCustomsValue = unitValue * quantity;
  const computedDuty = Math.round((totalCustomsValue * totalDutyRate) * 100) / 100;
  // Line-level fees are indicative only: MPF is a per-entry fee with a statutory
  // floor and ceiling, so the entry total is computed by the calculate endpoint.
  const computedFees = Math.round((calculateMPF(totalCustomsValue) + calculateHMF(totalCustomsValue, true)) * 100) / 100;
  const computedLandedCost = totalCustomsValue + freightCost + insuranceCost + computedDuty + computedFees;

  const lineItem = await db.landedCostScenarioLineItem.create({
    data: {
      scenarioId: id,
      description: description || hts.description,
      htsCodeId: hts.id,
      unitValue,
      quantity,
      freightCost,
      insuranceCost,
      dutyRateOverride,
      computedDuty,
      computedFees,
      computedLandedCost,
    },
    include: { htsCode: true },
  });

  return NextResponse.json({ lineItem }, { status: 201 });
}, { write: true });
