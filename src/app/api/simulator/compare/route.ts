import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { computeLandedCost } from "@/lib/tariff/landedCost";
import { z } from "zod";

const compareSchema = z.object({
  scenarioIds: z.array(z.string()).min(1).max(5),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await req.json();
  const parsed = compareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide between 1 and 5 scenarioIds to compare." }, { status: 400 });
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

  const compared = scenariosData.map((sc) => {
    let totalDuty = 0;
    let totalMpf = 0;
    let totalHmf = 0;
    let totalLandedCost = 0;

    for (const item of sc.lineItems) {
      const breakdown = computeLandedCost({
        productCost: Number(item.unitValue) * item.quantity,
        quantity: item.quantity,
        htsCode: item.htsCode.htsNumberDisplay,
        countryOfOrigin: sc.originCountry,
        freight: Number(item.freightCost),
        insurance: Number(item.insuranceCost),
      });

      totalDuty += breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232).toNumber();
      totalMpf += breakdown.mpf.toNumber();
      totalHmf += breakdown.hmf.toNumber();
      totalLandedCost += breakdown.total.toNumber();
    }

    return {
      id: sc.id,
      name: sc.name,
      originCountry: sc.originCountry,
      totalDuty: Math.round(totalDuty * 100) / 100,
      totalMpf: Math.round(totalMpf * 100) / 100,
      totalHmf: Math.round(totalHmf * 100) / 100,
      totalLandedCost: Math.round(totalLandedCost * 100) / 100,
    };
  });

  // Calculate savings matrix compared to the most expensive scenario
  const maxLandedCost = Math.max(...compared.map((c) => c.totalLandedCost));
  const savingsMatrix = compared.map((c) => ({
    scenarioId: c.id,
    savingsDelta: Math.max(0, maxLandedCost - c.totalLandedCost),
  }));

  return NextResponse.json({
    scenarios: compared,
    savingsMatrix,
  });
});
