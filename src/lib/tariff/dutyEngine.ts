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

/**
 * Whether a trade-remedy measure's applicability has actually been
 * determined for a given HTS code, as opposed to `false`/`0` -- which a
 * caller cannot distinguish from "genuinely evaluated and confirmed not
 * applicable." A measure is only EVALUATED_* once real ingested data (a
 * DB row) was consulted for this exact code; absence of any such row
 * means NOT_EVALUATED, not "not applicable."
 */
export type TradeMeasureEvaluationStatus =
  | "EVALUATED_APPLICABLE"
  | "EVALUATED_NOT_APPLICABLE"
  | "NOT_EVALUATED"
  | "DATA_UNAVAILABLE"
  | "REVIEW_REQUIRED";

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
  /** Additive evaluation-status metadata -- optional so existing callers keep working unchanged. */
  generalStatus?: TradeMeasureEvaluationStatus;
  section301Status?: TradeMeasureEvaluationStatus;
  section232Status?: TradeMeasureEvaluationStatus;
  antidumpingStatus?: TradeMeasureEvaluationStatus;
  countervailingStatus?: TradeMeasureEvaluationStatus;
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

/**
 * Section 232 (Steel/Aluminum) applicability, resolved from the real ingested
 * Section232Rate table -- previously hardcoded to `false`/`0` in both
 * loadHtsCodesMap and HtsNodeRepository.toDutyRateInput even though this
 * table and its ingestion already exist, which silently misrepresented
 * genuinely-ingested Section 232 duty as "not applicable." Absence of any
 * row for this HTS code means the code has not been evaluated against the
 * Section 232 program (NOT_EVALUATED), not that the program doesn't apply.
 */
export async function resolveSection232ForHtsCode(
  htsCode: string,
  countryOfOrigin?: string | null
): Promise<{ applicable: boolean; additionalRate: number; status: TradeMeasureEvaluationStatus }> {
  const { db } = await import("@/lib/db");
  const normalized = htsCode.replace(/[^0-9]/g, "");
  if (!normalized) return { applicable: false, additionalRate: 0, status: "NOT_EVALUATED" };

  const now = new Date();
  const rows = await db.section232Rate.findMany({
    where: { htsNumber: { in: [htsCode, normalized] }, reviewStatus: "APPROVED" },
  });

  const active = rows.filter(
    (r) => r.effectiveDate <= now && (r.expirationDate == null || r.expirationDate >= now)
  );
  if (active.length === 0) {
    return { applicable: false, additionalRate: 0, status: "NOT_EVALUATED" };
  }

  const country = countryOfOrigin?.toUpperCase() || null;
  const match =
    (country ? active.find((r) => r.countryOfOrigin?.toUpperCase() === country) : null) ??
    active.find((r) => !r.countryOfOrigin) ??
    active[0];

  if (match.isGeneralApprovedExclusion) {
    return { applicable: false, additionalRate: 0, status: "EVALUATED_NOT_APPLICABLE" };
  }

  return { applicable: true, additionalRate: match.baseRatePct, status: "EVALUATED_APPLICABLE" };
}

/**
 * Antidumping/countervailing duty, resolved from the real ingested
 * AdcvdOrder/AdCvdCompanyRate tables -- previously AdCvdCompanyRate had zero
 * read call sites in duty calculation at all, so the tradeRateReviewService
 * governance gate (PENDING -> APPROVED) had no computational effect: a
 * platform admin approving a company rate did nothing to any filing's duty.
 *
 * AD and CVD orders are distinguished by the case number's Commerce prefix
 * (A-### for antidumping, C-### for countervailing -- the real convention
 * used by ACCESS/Federal Register case numbers, not an internal invention).
 * A case whose HTS/country scope matches this line but has no APPROVED
 * company rate yet is REVIEW_REQUIRED, not "not applicable" -- an
 * unreviewed rate must never silently compute as 0% duty.
 */
export function classifyAdCvdCaseType(caseNumber: string): "ANTIDUMPING" | "COUNTERVAILING" | null {
  if (/^A-/i.test(caseNumber)) return "ANTIDUMPING";
  if (/^C-/i.test(caseNumber)) return "COUNTERVAILING";
  return null;
}

export interface AdCvdResolution {
  antidumpingRate: number | null;
  antidumpingStatus: TradeMeasureEvaluationStatus;
  countervailingRate: number | null;
  countervailingStatus: TradeMeasureEvaluationStatus;
}

export async function resolveAdCvdForHtsCode(
  htsCode: string,
  countryOfOrigin?: string | null,
  manufacturer?: string | null,
  exporter?: string | null
): Promise<AdCvdResolution> {
  const empty: AdCvdResolution = {
    antidumpingRate: null,
    antidumpingStatus: "NOT_EVALUATED",
    countervailingRate: null,
    countervailingStatus: "NOT_EVALUATED",
  };

  const normalized = htsCode.replace(/[^0-9]/g, "");
  const country = countryOfOrigin?.toUpperCase() || null;
  if (!normalized || !country) return empty;

  const { db } = await import("@/lib/db");
  const activeOrders = await db.adcvdOrder.findMany({ where: { status: "ACTIVE" } });

  // Order scope language is often written against 6- or 8-digit HTS headings
  // (the product scope is legally defined by description, not stat-suffix
  // precision), so a scope entry shorter than the line's 10-digit code is
  // matched as a prefix, not just by exact-string equality.
  const matchingOrders = activeOrders.filter(
    (o) =>
      o.respondentCountries.some((c) => c.toUpperCase() === country) &&
      o.htsCodesInScope.some((c) => {
        const scopeDigits = c.replace(/[^0-9]/g, "");
        return scopeDigits.length > 0 && normalized.startsWith(scopeDigits);
      })
  );
  if (matchingOrders.length === 0) return empty;

  const manufacturerNorm = manufacturer?.trim().toLowerCase() || null;
  const exporterNorm = exporter?.trim().toLowerCase() || null;

  const resolveForType = async (
    type: "ANTIDUMPING" | "COUNTERVAILING"
  ): Promise<{ rate: number | null; status: TradeMeasureEvaluationStatus }> => {
    const caseNumbers = matchingOrders
      .filter((o) => classifyAdCvdCaseType(o.caseNumber) === type)
      .map((o) => o.caseNumber);
    if (caseNumbers.length === 0) return { rate: null, status: "NOT_EVALUATED" };

    const rates = await db.adCvdCompanyRate.findMany({
      where: { caseNumber: { in: caseNumbers } },
      orderBy: { effectiveDate: "desc" },
    });

    // A case's respondentCountries can span more than one country (rare, but
    // real -- e.g. combined-country orders); company rates are still filed
    // per-country, so scope to this line's country when the rate specifies one.
    const scoped = rates.filter((r) => !r.countryOfOrigin || r.countryOfOrigin.toUpperCase() === country);
    if (scoped.length === 0) return { rate: null, status: "DATA_UNAVAILABLE" };

    const approved = scoped.filter((r) => r.reviewStatus === "APPROVED");
    if (approved.length === 0) return { rate: null, status: "REVIEW_REQUIRED" };

    const exact = approved.find(
      (r) =>
        r.isSeparateRate &&
        r.depositRatePct != null &&
        (r.manufacturerName.trim().toLowerCase() === manufacturerNorm ||
          (exporterNorm && r.exporterName?.trim().toLowerCase() === exporterNorm))
    );
    if (exact) return { rate: exact.depositRatePct as number, status: "EVALUATED_APPLICABLE" };

    const allOthers = approved.find((r) => r.allOthersRatePct != null);
    if (allOthers) return { rate: allOthers.allOthersRatePct as number, status: "EVALUATED_APPLICABLE" };

    return { rate: null, status: "REVIEW_REQUIRED" };
  };

  const [ad, cvd] = await Promise.all([resolveForType("ANTIDUMPING"), resolveForType("COUNTERVAILING")]);

  return {
    antidumpingRate: ad.rate,
    antidumpingStatus: ad.status,
    countervailingRate: cvd.rate,
    countervailingStatus: cvd.status,
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

    // Resolve AD/CVD rates: governed AdCvdCompanyRate (APPROVED only) takes
    // precedence when a matching order is in scope for this code/country --
    // that's the whole point of the review gate having computational effect.
    // Only when no order is in scope at all do we fall back to the older,
    // ungoverned node.dutyRates-sourced rate (e.g. demo/seed data flows).
    const adcvd = await resolveAdCvdForHtsCode(code, lineCountry ?? null, matchingLine?.manufacturer ?? null);

    let adRate = adcvd.antidumpingRate;
    let adStatus = adcvd.antidumpingStatus;
    let cvdRate = adcvd.countervailingRate;
    let cvdStatus = adcvd.countervailingStatus;

    if (adStatus === "NOT_EVALUATED" || cvdStatus === "NOT_EVALUATED") {
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

      if (adStatus === "NOT_EVALUATED") {
        const nodeAdRate = resolveMostSpecific(adRates);
        if (nodeAdRate != null) {
          adRate = nodeAdRate;
          adStatus = "EVALUATED_APPLICABLE";
        }
      }
      if (cvdStatus === "NOT_EVALUATED") {
        const nodeCvdRate = resolveMostSpecific(cvdRates);
        if (nodeCvdRate != null) {
          cvdRate = nodeCvdRate;
          cvdStatus = "EVALUATED_APPLICABLE";
        }
      }
    }

    const section232 = await resolveSection232ForHtsCode(code, lineCountry ?? null);

    map[code] = {
      generalDutyRate: general?.rawRateText ?? null,
      generalStatus: node ? (general ? "EVALUATED_APPLICABLE" : "DATA_UNAVAILABLE") : "DATA_UNAVAILABLE",
      section301Applicable: sec301Applicable,
      section301Tranche: sec301Tranche,
      section301AdditionalRate: sec301AdditionalRate,
      section301Exclusion: sec301Exclusion,
      section301Status: sec301Rate ? (sec301Applicable ? "EVALUATED_APPLICABLE" : "EVALUATED_NOT_APPLICABLE") : "NOT_EVALUATED",
      section232Applicable: section232.applicable,
      section232AdditionalRate: section232.additionalRate,
      section232Status: section232.status,
      antidumpingRate: adRate,
      antidumpingStatus: adStatus,
      countervailingRate: cvdRate,
      countervailingStatus: cvdStatus,
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
