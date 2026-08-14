import { Decimal } from "./decimal";
import { calculateDutyStack, calculateMPF, calculateHMF, DutyRateInput } from "./dutyEngine";

export interface LandedCostBreakdown {
  productCost: Decimal;       // FOB value
  freightToUSPort: Decimal;
  insuranceToUSPort: Decimal;
  customsValue: Decimal;      // = productCost + assists + royalties
  baseDuty: Decimal;
  section301: Decimal;
  section232: Decimal;
  adcvd: Decimal;
  mpf: Decimal;
  hmf: Decimal;
  stateFees: Decimal;
  inland: Decimal;
  total: Decimal;
  perUnit: Decimal;
}

export interface LandedCostInput {
  productCost: number;
  quantity: number;
  htsCode: string;
  countryOfOrigin: string;
  manufacturer?: string | null;
  tradeAgreementClaim?: string | null;
  freight: number;
  insurance: number;
  assists?: number;
  royalties?: number;
  inland?: number;
}

/**
 * Calculates landed cost breakdown (Task D-1, D-2)
 */
export function computeLandedCost(input: LandedCostInput, ratesInput?: DutyRateInput | null): LandedCostBreakdown {
  const qty = new Decimal(input.quantity || 1);
  const prodCost = new Decimal(input.productCost);
  const freight = new Decimal(input.freight || 0);
  const insurance = new Decimal(input.insurance || 0);
  const assists = new Decimal(input.assists || 0);
  const royalties = new Decimal(input.royalties || 0);
  const inland = new Decimal(input.inland || 0);

  // customsValue = productCost + assists + royalties (freight/insurance excluded if FOB incoterm)
  const customsVal = prodCost.plus(assists).plus(royalties);

  // Compute Duty Stack
  const dutyStack = calculateDutyStack(
    {
      htsCode: input.htsCode,
      totalValue: customsVal.toNumber(),
      countryOfOrigin: input.countryOfOrigin,
      manufacturer: input.manufacturer,
      tradeAgreementClaim: input.tradeAgreementClaim,
    },
    ratesInput ?? null,
    "hts_rel_v1"
  );

  const baseDuty = dutyStack.base;
  const section301 = dutyStack.section301;
  const section232 = dutyStack.section232;
  const adcvd = dutyStack.antidumping.plus(dutyStack.countervailing);

  // Per-entry Fees
  const mpf = new Decimal(calculateMPF(customsVal.toNumber()));
  const hmf = new Decimal(calculateHMF(customsVal.toNumber(), true));
  const stateFees = new Decimal(0); // Optional state fees

  // Total
  const total = customsVal
    .plus(freight)
    .plus(insurance)
    .plus(baseDuty)
    .plus(section301)
    .plus(section232)
    .plus(adcvd)
    .plus(mpf)
    .plus(hmf)
    .plus(stateFees)
    .plus(inland);

  const perUnit = total.dividedBy(qty);

  return {
    productCost: prodCost,
    freightToUSPort: freight,
    insuranceToUSPort: insurance,
    customsValue: customsVal,
    baseDuty,
    section301,
    section232,
    adcvd,
    mpf,
    hmf,
    stateFees,
    inland,
    total,
    perUnit,
  };
}

/**
 * Calculates real alternative-sourcing breakeven volume (Task D-4)
 * Derives crossover unit volume where total landed cost of Scenario B balances Scenario A.
 */
export function calculateSourcingBreakeven(
  scenarioA: LandedCostInput,
  scenarioB: LandedCostInput,
  rateA?: DutyRateInput | null,
  rateB?: DutyRateInput | null
): number {
  const fixedA = (scenarioA.freight || 0) + (scenarioA.insurance || 0) + (scenarioA.inland || 0);
  const fixedB = (scenarioB.freight || 0) + (scenarioB.insurance || 0) + (scenarioB.inland || 0);

  const breakdownA = computeLandedCost({ ...scenarioA, quantity: 1, freight: 0, insurance: 0, inland: 0 }, rateA);
  const breakdownB = computeLandedCost({ ...scenarioB, quantity: 1, freight: 0, insurance: 0, inland: 0 }, rateB);

  const unitVarA = breakdownA.total.toNumber();
  const unitVarB = breakdownB.total.toNumber();

  const deltaUnitVar = unitVarA - unitVarB;
  const deltaFixed = fixedB - fixedA;

  if (Math.abs(deltaUnitVar) < 0.0001) {
    return 0;
  }

  const breakeven = deltaFixed / deltaUnitVar;
  return Math.max(0, Math.round(breakeven));
}
