import { Decimal } from "./decimal";
import { calculateDutyStack, calculateMPF, calculateHMF } from "./dutyEngine";

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
  freight: number;
  insurance: number;
  assists?: number;
  royalties?: number;
  inland?: number;
}

/**
 * Calculates landed cost breakdown (Task D-1, D-2)
 */
export function computeLandedCost(input: LandedCostInput): LandedCostBreakdown {
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
    },
    {
      generalDutyRate: "2.8%",
      section301Applicable: input.countryOfOrigin === "CN",
      section301Tranche: "List3",
    },
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
