import { ShipmentLineItem } from "@prisma/client";
import { Decimal, roundToCents } from "./decimal";

/**
 * The engine only reads these four fields and coerces the numerics, so it also
 * accepts lines rehydrated from a filing snapshot, where money is plain JSON
 * numbers rather than Prisma Decimals.
 */
export type TariffLineInput = Pick<Partial<ShipmentLineItem>, "htsCode"> & {
  quantity?: ShipmentLineItem["quantity"] | number | null;
  unitPrice?: ShipmentLineItem["unitPrice"] | number | null;
  totalValue?: ShipmentLineItem["totalValue"] | number | null;
  countryOfOrigin?: string | null;
  manufacturer?: string | null;
  tradeAgreementClaim?: string | null;
};

export interface DutyRateInput {
  generalDutyRate?: string | null;
  section301Applicable?: boolean | null;
  section301AdditionalRate?: number | null;
  section301Tranche?: "List1" | "List2" | "List3" | "List4A" | "List4B" | string | null;
  section301Exclusion?: boolean | null;
  section232Applicable?: boolean | null;
  section232AdditionalRate?: number | null;
  antidumpingRate?: number | null;
  countervailingRate?: number | null;
}

export interface DutyStack {
  htsReleaseId: string;
  base: Decimal;
  section301: Decimal;
  section232: Decimal;
  antidumping: Decimal;
  countervailing: Decimal;
  other: Decimal;
  total: Decimal;
  mpf: Decimal;
  hmf: Decimal;
  totalWithFees: Decimal;
}

export interface LineItemDutyResult {
  customsValue: number;
  /** Null when no published rate could be resolved for the line's HTS code. */
  baseDutyRate: number | null;
  baseDutyAmount: number;
  section301Rate: number;
  section301Amount: number;
  section232Rate: number;
  section232Amount: number;
  totalDutyAmount: number;
  mpfAmount: number;
  hmfAmount: number;
  totalFeesAmount: number;
  totalAmount: number;
  dutyStack?: DutyStack;
}

export interface TariffEngineResult {
  totalCustomsValue: number;
  totalDuty: number;
  totalTaxes: number;
  totalFees: number;
  totalAmount: number;
  /** Lines with no resolvable duty rate. Any total above understates duty while > 0. */
  unratedLineCount: number;
  dutyBreakdown: Array<{
    feeName: string;
    amount: number;
    rate: string;
  }>;
  lineResults: LineItemDutyResult[];
}

export const MPF_RATE = new Decimal("0.003464");
export const MPF_MINIMUM = new Decimal("31.67");
export const MPF_MAXIMUM = new Decimal("614.35");
export const HMF_RATE = new Decimal("0.00125");

export function calculateMPFDecimal(customsValue: Decimal): Decimal {
  if (customsValue.lte(0)) return new Decimal(0);
  const rawMpf = customsValue.times(MPF_RATE);
  const clamped = Decimal.min(Decimal.max(rawMpf, MPF_MINIMUM), MPF_MAXIMUM);
  return roundToCents(clamped);
}

export function calculateHMFDecimal(customsValue: Decimal, isOcean: boolean = true): Decimal {
  if (!isOcean || customsValue.lte(0)) return new Decimal(0);
  return roundToCents(customsValue.times(HMF_RATE));
}

export function calculateMPF(customsValue: number): number {
  return calculateMPFDecimal(new Decimal(customsValue)).toNumber();
}

export function calculateHMF(customsValue: number, isOcean: boolean = true): number {
  return calculateHMFDecimal(new Decimal(customsValue), isOcean).toNumber();
}

/**
 * Calculates Section 301 additional duty rate based on China origin and Tranche list.
 */
export function getSection301Rate(
  countryOfOrigin?: string | null,
  tranche?: string | null,
  exclusion?: boolean | null
): Decimal {
  if (exclusion) return new Decimal(0);
  if (countryOfOrigin?.toUpperCase() !== "CN") return new Decimal(0);

  switch (tranche) {
    case "List1":
    case "List2":
    case "List3":
      return new Decimal("0.25");
    case "List4A":
      return new Decimal("0.075");
    case "List4B":
      return new Decimal("0.15");
    default:
      // D-2 Audit Requirement: Stop defaulting unknown tranches to 25%
      return new Decimal(0);
  }
}

/**
 * Pure Duty Stack calculation using Decimal arithmetic (Task D-1).
 */
export function calculateDutyStack(
  lineItem: TariffLineInput,
  htsRateInput?: DutyRateInput | null,
  htsReleaseId: string = "hts_rel_current"
): DutyStack {
  const totalValDec = lineItem.totalValue != null && String(lineItem.totalValue) !== "" ? new Decimal(lineItem.totalValue) : null;
  const qtyDec = new Decimal(lineItem.quantity ?? 1);
  const priceDec = new Decimal(lineItem.unitPrice ?? 0);
  const customsValue = roundToCents(totalValDec && totalValDec.gt(0) ? totalValDec : qtyDec.times(priceDec));

  const isUsmca = lineItem.tradeAgreementClaim?.toUpperCase() === "USMCA";

  const baseRateNum = parsePublishedDutyRate(htsRateInput?.generalDutyRate);
  const baseRate = isUsmca ? new Decimal(0) : new Decimal(baseRateNum ?? 0);
  const baseDuty = roundToCents(customsValue.times(baseRate));

  const sec301Rate = isUsmca
    ? new Decimal(0)
    : (htsRateInput?.section301Applicable
        ? (htsRateInput.section301AdditionalRate != null
            ? new Decimal(htsRateInput.section301AdditionalRate).dividedBy(100)
            : getSection301Rate(
                lineItem.countryOfOrigin,
                htsRateInput?.section301Tranche,
                htsRateInput?.section301Exclusion
              ))
        : (htsRateInput?.section301Tranche
            ? getSection301Rate(
                lineItem.countryOfOrigin,
                htsRateInput?.section301Tranche,
                htsRateInput?.section301Exclusion
              )
            : new Decimal(0)));
  const sec301Duty = roundToCents(customsValue.times(sec301Rate));

  const sec232Rate = htsRateInput?.section232Applicable
    ? new Decimal(htsRateInput.section232AdditionalRate || 0).dividedBy(100)
    : new Decimal(0);
  const sec232Duty = roundToCents(customsValue.times(sec232Rate));

  const adRate = new Decimal(htsRateInput?.antidumpingRate || 0).dividedBy(100);
  const adDuty = roundToCents(customsValue.times(adRate));

  const cvdRate = new Decimal(htsRateInput?.countervailingRate || 0).dividedBy(100);
  const cvdDuty = roundToCents(customsValue.times(cvdRate));

  const otherDuty = new Decimal(0);

  const totalDuty = baseDuty
    .plus(sec301Duty)
    .plus(sec232Duty)
    .plus(adDuty)
    .plus(cvdDuty)
    .plus(otherDuty);

  const mpf = calculateMPFDecimal(customsValue);
  const hmf = calculateHMFDecimal(customsValue, true);
  const totalWithFees = totalDuty.plus(mpf).plus(hmf);

  return {
    htsReleaseId,
    base: baseDuty,
    section301: sec301Duty,
    section232: sec232Duty,
    antidumping: adDuty,
    countervailing: cvdDuty,
    other: otherDuty,
    total: totalDuty,
    mpf,
    hmf,
    totalWithFees,
  };
}

export async function loadHtsCodesMap(
  lineItems: Array<TariffLineInput>,
  country: string = "US"
): Promise<Record<string, DutyRateInput>> {
  const { db } = await import("@/lib/db");
  const codes = [...new Set(lineItems.map((li) => li.htsCode).filter((c): c is string => !!c))];
  if (codes.length === 0) return {};

  const publishedRelease = await db.htsRelease.findFirst({
    where: { country, publicationStatus: "PUBLISHED" },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true },
  });

  const normalizedOf = new Map(codes.map((code) => [code, code.replace(/[^0-9]/g, "")]));

  const nodes = publishedRelease
    ? await db.htsNode.findMany({
        where: {
          releaseId: publishedRelease.id,
          htsNumberNormalized: { in: [...normalizedOf.values()].filter(Boolean) },
        },
        include: { dutyRates: true },
      })
    : [];
  const byNormalized = new Map(nodes.map((n) => [n.htsNumberNormalized, n]));

  const map: Record<string, DutyRateInput> = {};
  for (const code of codes) {
    const norm = normalizedOf.get(code) ?? "";
    const node = byNormalized.get(norm);
    const general = node?.dutyRates.find((r) => r.rateColumn === "General");
    
    // Check Section 301 duty rate in DB
    const sec301Rate = node?.dutyRates.find(
      (r) => r.rateType === "SECTION_301" || r.rateColumn === "Section301"
    );
    
    // Check line items matching this HTS code to determine country/manufacturer
    const matchingLine = lineItems.find((li) => li.htsCode === code);
    const lineCountry = matchingLine?.countryOfOrigin?.toUpperCase();
    const lineManufacturer = matchingLine?.manufacturer?.trim().toLowerCase();

    let sec301Applicable = false;
    let sec301Tranche: string | null = null;
    let sec301AdditionalRate: number | null = null;
    let sec301Exclusion = false;

    if (sec301Rate) {
      sec301Applicable = lineCountry ? lineCountry === "CN" : true;
      sec301Tranche = sec301Rate.trancheId ?? null;
      let parsedRate = sec301Rate.adValoremPercent ?? null;
      if (parsedRate === null && sec301Rate.rawRateText) {
        const p = parsePublishedDutyRate(sec301Rate.rawRateText);
        parsedRate = p !== null ? p * 100 : (isNaN(parseFloat(sec301Rate.rawRateText)) ? null : parseFloat(sec301Rate.rawRateText));
      }
      sec301AdditionalRate = parsedRate;
      sec301Exclusion = sec301Rate.exclusion;
    }

    // Resolve AD/CVD rates with "most specific wins" logic
    let adRate: number | null = null;
    let cvdRate: number | null = null;

    const adRates = node?.dutyRates.filter(
      (r) => r.rateType === "ANTIDUMPING" || r.rateColumn === "AD_CVD" && r.programCode?.includes("AD")
    ) ?? [];

    const cvdRates = node?.dutyRates.filter(
      (r) => r.rateType === "COUNTERVAILING" || r.rateColumn === "AD_CVD" && r.programCode?.includes("CVD")
    ) ?? [];

    const resolveMostSpecific = (rates: typeof adRates) => {
      if (rates.length === 0) return null;
      // 1. Exact manufacturer + country match
      const exact = rates.find(
        (r) =>
          r.manufacturer?.trim().toLowerCase() === lineManufacturer &&
          r.countryOfOrigin?.toUpperCase() === lineCountry
      );
      if (exact) return exact.adValoremPercent ?? (exact.rawRateText ? parseFloat(exact.rawRateText) : null);

      // 2. Country match with wildcard or null manufacturer
      const countryMatch = rates.find(
        (r) =>
          r.countryOfOrigin?.toUpperCase() === lineCountry &&
          (!r.manufacturer || r.manufacturer === "*")
      );
      if (countryMatch) return countryMatch.adValoremPercent ?? (countryMatch.rawRateText ? parseFloat(countryMatch.rawRateText) : null);

      // 3. Fallback to first matched rate for node
      const fallback = rates[0];
      return fallback?.adValoremPercent ?? (fallback?.rawRateText ? parseFloat(fallback.rawRateText) : null);
    };

    adRate = resolveMostSpecific(adRates);
    cvdRate = resolveMostSpecific(cvdRates);

    map[code] = {
      generalDutyRate: general?.rawRateText ?? null,
      section301Applicable: sec301Applicable,
      section301Tranche: sec301Tranche,
      section301AdditionalRate: sec301AdditionalRate,
      section301Exclusion: sec301Exclusion,
      section232Applicable: false,
      section232AdditionalRate: 0,
      antidumpingRate: adRate,
      countervailingRate: cvdRate,
    };
  }
  return map;
}

export function parsePublishedDutyRate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (/^free\b/i.test(text)) return 0;
  const parsed = parseFloat(text.replace("%", ""));
  return isNaN(parsed) ? null : parsed / 100;
}

export function calculateLineItemDuty(
  lineItem: TariffLineInput,
  htsCode?: DutyRateInput | null
): LineItemDutyResult {
  const stack = calculateDutyStack(lineItem, htsCode);
  const totalValDec = lineItem.totalValue != null && String(lineItem.totalValue) !== "" ? new Decimal(lineItem.totalValue) : null;
  const qtyDec = new Decimal(lineItem.quantity ?? 1);
  const priceDec = new Decimal(lineItem.unitPrice ?? 0);
  const customsValueDec = roundToCents(totalValDec && totalValDec.gt(0) ? totalValDec : qtyDec.times(priceDec));

  const baseDutyRate = parsePublishedDutyRate(htsCode?.generalDutyRate);

  return {
    customsValue: customsValueDec.toNumber(),
    baseDutyRate,
    baseDutyAmount: stack.base.toNumber(),
    section301Rate: htsCode?.section301Applicable ? (Number(htsCode.section301AdditionalRate) || 0) / 100 : 0,
    section301Amount: stack.section301.toNumber(),
    section232Rate: htsCode?.section232Applicable ? (Number(htsCode.section232AdditionalRate) || 0) / 100 : 0,
    section232Amount: stack.section232.toNumber(),
    totalDutyAmount: stack.total.toNumber(),
    mpfAmount: stack.mpf.toNumber(),
    hmfAmount: stack.hmf.toNumber(),
    totalFeesAmount: stack.mpf.plus(stack.hmf).toNumber(),
    totalAmount: stack.totalWithFees.toNumber(),
    dutyStack: stack,
  };
}

export function computeFilingTariff(
  lineItems: Array<TariffLineInput>,
  htsCodesMap: Record<string, DutyRateInput> = {}
): TariffEngineResult {
  let totalCustomsValueDec = new Decimal(0);
  let totalBaseDutyDec = new Decimal(0);
  let totalSec301Dec = new Decimal(0);
  let totalSec232Dec = new Decimal(0);
  const lineResults: LineItemDutyResult[] = [];
  let unratedLineCount = 0;

  for (const item of lineItems) {
    const hts = item.htsCode ? htsCodesMap[item.htsCode] : null;
    const res = calculateLineItemDuty(item, hts);
    if (res.baseDutyRate === null) unratedLineCount++;
    totalCustomsValueDec = totalCustomsValueDec.plus(new Decimal(res.customsValue));
    totalBaseDutyDec = totalBaseDutyDec.plus(new Decimal(res.baseDutyAmount));
    totalSec301Dec = totalSec301Dec.plus(new Decimal(res.section301Amount));
    totalSec232Dec = totalSec232Dec.plus(new Decimal(res.section232Amount));
    lineResults.push(res);
  }

  const roundedCustomsValue = roundToCents(totalCustomsValueDec);
  const totalDutyDec = roundToCents(totalBaseDutyDec.plus(totalSec301Dec).plus(totalSec232Dec));
  const totalMpfDec = calculateMPFDecimal(roundedCustomsValue);
  const totalHmfDec = calculateHMFDecimal(roundedCustomsValue, true);
  const totalFeesDec = roundToCents(totalMpfDec.plus(totalHmfDec));
  const totalAmountDec = roundToCents(totalDutyDec.plus(totalFeesDec));

  const totalBaseDutyNum = roundedCustomsValue.gt(0) ? totalBaseDutyDec.dividedBy(roundedCustomsValue).times(100).toNumber() : 0;
  const totalSec301Num = roundedCustomsValue.gt(0) ? totalSec301Dec.dividedBy(roundedCustomsValue).times(100).toNumber() : 0;
  const totalSec232Num = roundedCustomsValue.gt(0) ? totalSec232Dec.dividedBy(roundedCustomsValue).times(100).toNumber() : 0;

  const dutyBreakdown = [
    {
      feeName: "Base Customs Duty",
      amount: roundToCents(totalBaseDutyDec).toNumber(),
      rate: roundedCustomsValue.gt(0) ? `${totalBaseDutyNum.toFixed(2)}%` : "0.0%",
    },
    ...(totalSec301Dec.gt(0)
      ? [
          {
            feeName: "Section 301 Trade Remedy Tariff",
            amount: roundToCents(totalSec301Dec).toNumber(),
            rate: `${totalSec301Num.toFixed(1)}%`,
          },
        ]
      : []),
    ...(totalSec232Dec.gt(0)
      ? [
          {
            feeName: "Section 232 Trade Remedy Tariff",
            amount: roundToCents(totalSec232Dec).toNumber(),
            rate: `${totalSec232Num.toFixed(1)}%`,
          },
        ]
      : []),
    {
      feeName: "Merchandise Processing Fee (MPF)",
      amount: totalMpfDec.toNumber(),
      rate: "0.3464% (statutory min $31.67 / max $614.35)",
    },
    {
      feeName: "Harbor Maintenance Fee (HMF)",
      amount: totalHmfDec.toNumber(),
      rate: "0.125%",
    },
  ];

  return {
    totalCustomsValue: roundedCustomsValue.toNumber(),
    totalDuty: totalDutyDec.toNumber(),
    unratedLineCount,
    totalTaxes: 0,
    totalFees: totalFeesDec.toNumber(),
    totalAmount: totalAmountDec.toNumber(),
    dutyBreakdown,
    lineResults,
  };
}
