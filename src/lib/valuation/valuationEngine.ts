import { Decimal, roundToCents, toNumber } from "../tariff/decimal";

export interface AssistInput {
  category: "materials" | "tools" | "engineering" | "molds" | string;
  description?: string;
  unitCost: number | string;
  quantity: number;
  prorationMethod?: "per_unit" | "entire_shipment" | string;
}

export interface ValuationInput {
  invoiceValue: number | string;
  currency?: string;
  assists?: AssistInput[];
  royalties?: number | string;
  commissions?: number | string;
  freightToUSPort?: number | string;
  insuranceToUSPort?: number | string;
  relatedParty?: boolean;
  discounts?: number | string;
  basis?: "TRANSACTION" | "IDENTICAL_GOODS" | "SIMILAR_GOODS" | "DEDUCTIVE" | "COMPUTED";
}

export interface ValuationResult {
  invoiceValue: number;
  currency: string;
  assistsTotal: number;
  additionsTotal: number;
  deductionsTotal: number;
  transactionValue: number;
  customsValue: number;
  basis: "TRANSACTION" | "IDENTICAL_GOODS" | "SIMILAR_GOODS" | "DEDUCTIVE" | "COMPUTED";
  relatedParty: boolean;
  relatedPartyFlagged: boolean;
  breakdown: {
    invoice: number;
    assists: number;
    royalties: number;
    commissions: number;
    freightDeduction: number;
    insuranceDeduction: number;
    discountsDeduction: number;
  };
}

/**
 * Pure customs valuation engine complying with 19 CFR 152.103 using Decimal arithmetic.
 */
export function calculateCustomsValuation(input: ValuationInput): ValuationResult {
  const invDecimal = new Decimal(input.invoiceValue || 0);
  const currency = input.currency || "USD";
  const relatedParty = Boolean(input.relatedParty);

  // 1. Calculate assists total (19 CFR 152.103 assist categories)
  let assistsDecimal = new Decimal(0);
  if (Array.isArray(input.assists)) {
    for (const assist of input.assists) {
      const unitCost = new Decimal(assist.unitCost || 0);
      const qty = new Decimal(assist.quantity || 1);
      assistsDecimal = assistsDecimal.plus(unitCost.times(qty));
    }
  }

  const royaltiesDecimal = new Decimal(input.royalties || 0);
  const commissionsDecimal = new Decimal(input.commissions || 0);
  const additionsDecimal = assistsDecimal.plus(royaltiesDecimal).plus(commissionsDecimal);

  const freightDecimal = new Decimal(input.freightToUSPort || 0);
  const insuranceDecimal = new Decimal(input.insuranceToUSPort || 0);
  const discountsDecimal = new Decimal(input.discounts || 0);
  const deductionsDecimal = freightDecimal.plus(insuranceDecimal).plus(discountsDecimal);

  // 2. Customs Value = Transaction Value = Invoice + Additions - Deductions
  const transactionDecimal = roundToCents(invDecimal.plus(additionsDecimal).minus(deductionsDecimal));
  const customsDecimal = Decimal.max(new Decimal(0), transactionDecimal);

  const basis = input.basis || "TRANSACTION";

  return {
    invoiceValue: toNumber(roundToCents(invDecimal)),
    currency,
    assistsTotal: toNumber(roundToCents(assistsDecimal)),
    additionsTotal: toNumber(roundToCents(additionsDecimal)),
    deductionsTotal: toNumber(roundToCents(deductionsDecimal)),
    transactionValue: toNumber(transactionDecimal),
    customsValue: toNumber(customsDecimal),
    basis,
    relatedParty,
    relatedPartyFlagged: relatedParty,
    breakdown: {
      invoice: toNumber(roundToCents(invDecimal)),
      assists: toNumber(roundToCents(assistsDecimal)),
      royalties: toNumber(roundToCents(royaltiesDecimal)),
      commissions: toNumber(roundToCents(commissionsDecimal)),
      freightDeduction: toNumber(roundToCents(freightDecimal)),
      insuranceDeduction: toNumber(roundToCents(insuranceDecimal)),
      discountsDeduction: toNumber(roundToCents(discountsDecimal)),
    },
  };
}
