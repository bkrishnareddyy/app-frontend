import { HTSCode, ShipmentLineItem } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * The engine only reads these four fields and coerces the numerics, so it also
 * accepts lines rehydrated from a filing snapshot, where money is plain JSON
 * numbers rather than Prisma Decimals.
 */
export type TariffLineInput = Pick<Partial<ShipmentLineItem>, "htsCode"> & {
  quantity?: ShipmentLineItem["quantity"] | number | null;
  unitPrice?: ShipmentLineItem["unitPrice"] | number | null;
  totalValue?: ShipmentLineItem["totalValue"] | number | null;
};

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

export const MPF_RATE = 0.003464;
export const MPF_MINIMUM = 31.67;
export const MPF_MAXIMUM = 614.35;
export const HMF_RATE = 0.00125;

export function calculateMPF(customsValue: number): number {
  if (customsValue <= 0) return 0;
  const rawMpf = customsValue * MPF_RATE;
  const clamped = Math.min(Math.max(rawMpf, MPF_MINIMUM), MPF_MAXIMUM);
  return Math.round(clamped * 100) / 100;
}

export function calculateHMF(customsValue: number, isOcean: boolean = true): number {
  if (!isOcean || customsValue <= 0) return 0;
  return Math.round((customsValue * HMF_RATE) * 100) / 100;
}

/**
 * Loads the tariff master rows for a set of line items. Without this the engine sees
 * no HTS data at all and every line comes back unrated with no Section 301/232 duty.
 */
export async function loadHtsCodesMap(
  lineItems: Array<TariffLineInput>
): Promise<Record<string, Partial<HTSCode>>> {
  const codes = [...new Set(lineItems.map((li) => li.htsCode).filter((c): c is string => !!c))];
  if (codes.length === 0) return {};

  const rows = await db.hTSCode.findMany({ where: { htsCode10: { in: codes } } });
  return Object.fromEntries(rows.map((row) => [row.htsCode10, row]));
}

export function calculateLineItemDuty(
  lineItem: TariffLineInput,
  htsCode?: Partial<HTSCode> | null
): LineItemDutyResult {
  const customsValue = Math.round(((Number(lineItem.totalValue) || (Number(lineItem.quantity) || 1) * (Number(lineItem.unitPrice) || 0))) * 100) / 100;

  // No published rate means the duty is unknown, not 2.8% and not zero. Callers must
  // check unratedLineCount before presenting a total as complete.
  let baseDutyRate: number | null = null;
  if (htsCode?.generalDutyRate) {
    const parsed = parseFloat(htsCode.generalDutyRate.replace("%", ""));
    if (!isNaN(parsed)) baseDutyRate = parsed / 100;
  }

  const section301Rate = htsCode?.section301Applicable ? (Number(htsCode.section301AdditionalRate) || 0) / 100 : 0;
  const section232Rate = htsCode?.section232Applicable ? (Number(htsCode.section232AdditionalRate) || 0) / 100 : 0;

  const baseDutyAmount = baseDutyRate === null ? 0 : Math.round((customsValue * baseDutyRate) * 100) / 100;
  const section301Amount = Math.round((customsValue * section301Rate) * 100) / 100;
  const section232Amount = Math.round((customsValue * section232Rate) * 100) / 100;

  const totalDutyAmount = Math.round((baseDutyAmount + section301Amount + section232Amount) * 100) / 100;
  const mpfAmount = calculateMPF(customsValue);
  const hmfAmount = calculateHMF(customsValue, true);
  const totalFeesAmount = Math.round((mpfAmount + hmfAmount) * 100) / 100;

  return {
    customsValue,
    baseDutyRate,
    baseDutyAmount,
    section301Rate,
    section301Amount,
    section232Rate,
    section232Amount,
    totalDutyAmount,
    mpfAmount,
    hmfAmount,
    totalFeesAmount,
    totalAmount: Math.round((totalDutyAmount + totalFeesAmount) * 100) / 100,
  };
}

export function computeFilingTariff(
  lineItems: Array<TariffLineInput>,
  htsCodesMap: Record<string, Partial<HTSCode>> = {}
): TariffEngineResult {
  let totalCustomsValue = 0;
  let totalBaseDuty = 0;
  let totalSec301 = 0;
  let totalSec232 = 0;
  const lineResults: LineItemDutyResult[] = [];
  let unratedLineCount = 0;

  for (const item of lineItems) {
    const hts = item.htsCode ? htsCodesMap[item.htsCode] : null;
    const res = calculateLineItemDuty(item, hts);
    if (res.baseDutyRate === null) unratedLineCount++;
    totalCustomsValue += res.customsValue;
    totalBaseDuty += res.baseDutyAmount;
    totalSec301 += res.section301Amount;
    totalSec232 += res.section232Amount;
    lineResults.push(res);
  }

  totalCustomsValue = Math.round(totalCustomsValue * 100) / 100;
  const totalDuty = Math.round((totalBaseDuty + totalSec301 + totalSec232) * 100) / 100;
  const totalMpf = calculateMPF(totalCustomsValue);
  const totalHmf = calculateHMF(totalCustomsValue, true);
  const totalFees = Math.round((totalMpf + totalHmf) * 100) / 100;
  const totalAmount = Math.round((totalDuty + totalFees) * 100) / 100;

  const dutyBreakdown = [
    {
      feeName: "Base Customs Duty",
      amount: Math.round(totalBaseDuty * 100) / 100,
      rate: totalCustomsValue > 0 ? `${((totalBaseDuty / totalCustomsValue) * 100).toFixed(2)}%` : "0.0%",
    },
    ...(totalSec301 > 0
      ? [
          {
            feeName: "Section 301 Trade Remedy Tariff",
            amount: Math.round(totalSec301 * 100) / 100,
            rate: `${((totalSec301 / totalCustomsValue) * 100).toFixed(1)}%`,
          },
        ]
      : []),
    ...(totalSec232 > 0
      ? [
          {
            feeName: "Section 232 Trade Remedy Tariff",
            amount: Math.round(totalSec232 * 100) / 100,
            rate: `${((totalSec232 / totalCustomsValue) * 100).toFixed(1)}%`,
          },
        ]
      : []),
    {
      feeName: "Merchandise Processing Fee (MPF)",
      amount: totalMpf,
      rate: "0.3464% (statutory min $31.67 / max $614.35)",
    },
    {
      feeName: "Harbor Maintenance Fee (HMF)",
      amount: totalHmf,
      rate: "0.125%",
    },
  ];

  return {
    totalCustomsValue,
    totalDuty,
    unratedLineCount,
    totalTaxes: 0,
    totalFees,
    totalAmount,
    dutyBreakdown,
    lineResults,
  };
}
