import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams, parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { HtsNodeRepository } from "@/repositories/htsNodeRepository";
import { calculateMPFDecimal, calculateHMFDecimal, parsePublishedDutyRate } from "@/lib/tariff/dutyEngine";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({
  description: z.string().optional(),
  htsCode10: z.string().min(1, "htsCode10 is required — a real HTS code, not a fallback default"),
  unitValue: z.number().positive(),
  quantity: z.number().int().positive(),
  freightCost: z.number().optional(),
  insuranceCost: z.number().optional(),
  dutyRateOverride: z.number().optional(),
});

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { description, htsCode10, unitValue, quantity, freightCost, insuranceCost, dutyRateOverride } = bodyVal.data;

  if (typeof htsCode10 !== "string" || htsCode10.trim() === "") {
    return NextResponse.json({ error: "htsCode10 is required", code: "HTS_CODE_REQUIRED" },
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

  // Resolves against the real ingested HTS Master Release data. This used to fall
  // back to a hardcoded "8481.80.5090" at 2.8% and would fabricate a tariff row
  // when the code was unknown; an unresolvable code is now a 404.
  const normalizedCode = htsCode10.replace(/[^0-9]/g, "");
  const node = normalizedCode ? await HtsNodeRepository.findByNormalizedCode(normalizedCode) : null;
  if (!node) {
    return NextResponse.json(
      { error: `HTS code ${htsCode10} not found in the HTS Master Release data`, code: "HTS_CODE_NOT_FOUND" },
      { status: 404 }
    );
  }
  const dutyRateInput = HtsNodeRepository.toDutyRateInput(node);

  let baseDutyRate: number | null = null;
  if (typeof dutyRateOverride === "number" && Number.isFinite(dutyRateOverride)) {
    baseDutyRate = dutyRateOverride / 100;
  } else {
    baseDutyRate = parsePublishedDutyRate(dutyRateInput.generalDutyRate);
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

  const section301Rate = dutyRateInput.section301Applicable ? (Number(dutyRateInput.section301AdditionalRate) || 0) / 100 : 0.0;
  const section232Rate = dutyRateInput.section232Applicable ? (Number(dutyRateInput.section232AdditionalRate) || 0) / 100 : 0.0;

  const baseDutyRateDec = new Decimal(baseDutyRate);
  const section301RateDec = new Decimal(section301Rate);
  const section232RateDec = new Decimal(section232Rate);

  const totalDutyRateDec = baseDutyRateDec.plus(section301RateDec).plus(section232RateDec);
  const totalCustomsValueDec = roundToCents(new Decimal(unitValue).times(quantity));
  const computedDutyDec = roundToCents(totalCustomsValueDec.times(totalDutyRateDec));
  const mpfDec = calculateMPFDecimal(totalCustomsValueDec);
  const hmfDec = calculateHMFDecimal(totalCustomsValueDec, true);
  const computedFeesDec = roundToCents(mpfDec.plus(hmfDec));
  const computedLandedCostDec = totalCustomsValueDec
    .plus(new Decimal(freightCost || 0))
    .plus(new Decimal(insuranceCost || 0))
    .plus(computedDutyDec)
    .plus(computedFeesDec);

  const computedDuty = computedDutyDec.toNumber();
  const computedFees = computedFeesDec.toNumber();
  const computedLandedCost = computedLandedCostDec.toNumber();

  const lineItem = await db.landedCostScenarioLineItem.create({
    data: {
      scenarioId: id,
      description: description || node.description,
      htsCodeId: node.id,
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

}, { permission: "intel.read", write: true });
