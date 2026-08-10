import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams, parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { HtsNodeRepository } from "@/repositories/htsNodeRepository";
import { calculateMPF, calculateHMF } from "@/lib/tariff/dutyEngine";
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

  const scenario = await db.landedCostScenario.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  // Looks up the real ingested HTS Master Release data (HtsNode/HtsDutyRate)
  // -- this used to silently fall back to a hardcoded "8481.80.5090" /
  // "Default Valve Appliance" / 2.8% rate, and would fabricate a brand-new
  // HTSCode row if the code wasn't found. Now: a real code is required, and
  // an unresolvable code is a 404, not a fabricated fallback.
  const normalizedCode = htsCode10.replace(/[^0-9]/g, "");
  const node = normalizedCode ? await HtsNodeRepository.findByNormalizedCode(normalizedCode) : null;
  if (!node) {
    return NextResponse.json({ error: `HTS code "${htsCode10}" was not found in the HTS Master Release data` }, { status: 404 });
  }
  const dutyRateInput = HtsNodeRepository.toDutyRateInput(node);

  // Calculate duty and landed cost
  const baseDutyRate = dutyRateOverride !== undefined
    ? dutyRateOverride / 100
    : (dutyRateInput.generalDutyRate ? parseFloat(dutyRateInput.generalDutyRate.replace("%", "")) / 100 : NaN) || 0.028;

  const section301Rate = dutyRateInput.section301Applicable ? (Number(dutyRateInput.section301AdditionalRate) || 0) / 100 : 0.0;
  const section232Rate = dutyRateInput.section232Applicable ? (Number(dutyRateInput.section232AdditionalRate) || 0) / 100 : 0.0;

  const totalDutyRate = baseDutyRate + section301Rate + section232Rate;
  const totalCustomsValue = unitValue * quantity;
  const computedDuty = Math.round((totalCustomsValue * totalDutyRate) * 100) / 100;
  const computedFees = Math.round((calculateMPF(totalCustomsValue) + calculateHMF(totalCustomsValue, true)) * 100) / 100;
  const computedLandedCost = totalCustomsValue + (freightCost || 0) + (insuranceCost || 0) + computedDuty + computedFees;

  const lineItem = await db.landedCostScenarioLineItem.create({
    data: {
      scenarioId: id,
      description: description || node.description,
      htsCodeId: node.id,
      unitValue,
      quantity,
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
});
