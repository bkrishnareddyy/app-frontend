import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { computeLandedCost, calculateSourcingBreakeven, LandedCostInput } from "@/lib/tariff/landedCost";
import { loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";
import { z } from "zod";

const compareSchema = z.object({
  scenarioIds: z.array(z.string()).min(1).max(5),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await req.json();
  const parsed = compareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide between 1 and 5 scenarioIds to compare." });
  }

  const { scenarioIds } = parsed.data;

  const scenariosData = await db.landedCostScenario.findMany({
    where: { id: { in: scenarioIds }, accountId: ctx.accountId },
    include: {
      lineItems: {
        include: { htsCode: true },
      },
    },
  });

  // Load HTS duty rates from the database for all line items across all scenarios
  const allLineItems = scenariosData.flatMap((sc) =>
    sc.lineItems.map((item) => ({
      htsCode: item.htsCode.htsNumberDisplay,
      countryOfOrigin: sc.originCountry,
      manufacturer: item.manufacturer || sc.manufacturer || undefined,
      tradeAgreementClaim: item.tradeAgreementClaim || sc.tradeAgreementClaim || undefined,
    }))
  );
  const htsCodesMap = await loadHtsCodesMap(allLineItems);

  const scenarioInputs: Record<string, LandedCostInput> = {};

  const compared = scenariosData.map((sc) => {
    let totalDutyDec = new Decimal(0);
    let totalMpfDec = new Decimal(0);
    let totalHmfDec = new Decimal(0);
    let totalLandedCostDec = new Decimal(0);

    const firstItem = sc.lineItems[0];
    if (firstItem) {
      scenarioInputs[sc.id] = {
        productCost: Number(firstItem.unitValue) * firstItem.quantity,
        quantity: firstItem.quantity,
        htsCode: firstItem.htsCode.htsNumberDisplay,
        countryOfOrigin: sc.originCountry,
        manufacturer: firstItem.manufacturer || sc.manufacturer || undefined,
        tradeAgreementClaim: firstItem.tradeAgreementClaim || sc.tradeAgreementClaim || undefined,
        freight: Number(firstItem.freightCost),
        insurance: Number(firstItem.insuranceCost),
      };
    }

    for (const item of sc.lineItems) {
      const breakdown = computeLandedCost({
        productCost: Number(item.unitValue) * item.quantity,
        quantity: item.quantity,
        htsCode: item.htsCode.htsNumberDisplay,
        countryOfOrigin: sc.originCountry,
        manufacturer: item.manufacturer || sc.manufacturer || undefined,
        tradeAgreementClaim: item.tradeAgreementClaim || sc.tradeAgreementClaim || undefined,
        freight: Number(item.freightCost),
        insurance: Number(item.insuranceCost),
      }, htsCodesMap[item.htsCode.htsNumberDisplay]);

      totalDutyDec = totalDutyDec.plus(breakdown.baseDuty).plus(breakdown.section301).plus(breakdown.section232);
      totalMpfDec = totalMpfDec.plus(breakdown.mpf);
      totalHmfDec = totalHmfDec.plus(breakdown.hmf);
      totalLandedCostDec = totalLandedCostDec.plus(breakdown.total);
    }

    return {
      id: sc.id,
      name: sc.name,
      originCountry: sc.originCountry,
      tradeAgreementClaim: sc.tradeAgreementClaim,
      totalDuty: roundToCents(totalDutyDec).toNumber(),
      totalMpf: roundToCents(totalMpfDec).toNumber(),
      totalHmf: roundToCents(totalHmfDec).toNumber(),
      totalLandedCost: roundToCents(totalLandedCostDec).toNumber(),
    };
  });

  // Calculate savings matrix compared to the most expensive scenario
  const maxLandedCost = Math.max(...compared.map((c) => c.totalLandedCost));
  const maxLandedCostDec = new Decimal(maxLandedCost);
  const savingsMatrix = compared.map((c) => ({
    scenarioId: c.id,
    savingsDelta: roundToCents(Decimal.max(0, maxLandedCostDec.minus(new Decimal(c.totalLandedCost)))).toNumber(),
  }));

  // Derive breakeven volume between top 2 scenarios if available
  let breakevenVolume: number | null = null;
  if (scenariosData.length >= 2 && scenarioInputs[scenariosData[0].id] && scenarioInputs[scenariosData[1].id]) {
    const inputA = scenarioInputs[scenariosData[0].id];
    const inputB = scenarioInputs[scenariosData[1].id];
    breakevenVolume = calculateSourcingBreakeven(
      inputA,
      inputB,
      htsCodesMap[inputA.htsCode],
      htsCodesMap[inputB.htsCode]
    );
  }

  return NextResponse.json({
    scenarios: compared,
    savingsMatrix,
    breakevenVolume,
  });

}, { permission: "intel.read", write: true });
