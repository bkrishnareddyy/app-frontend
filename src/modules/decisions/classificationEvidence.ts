/**
 * Reading duty rates off an HTS record and comparing two of them.
 *
 * Published rates are text, not numbers: "Free", "2.5%", "6.5% + 3.5c/kg",
 * "13.2c/kg". Only an ad valorem rate can be turned into a percentage, and only
 * two ad valorem rates can be subtracted from each other. Everything else has to
 * say it cannot be compared rather than fall back to zero, because a real duty
 * of zero and an uncomparable rate are different answers.
 */

/** "Free" is a published rate meaning zero duty, not a missing value. */
const FREE_PATTERN = /^free$/i;

/** A bare ad valorem rate: "2.5%", "0%", "17.6 %". Nothing else may match. */
const AD_VALOREM_PATTERN = /^(\d+(?:\.\d+)?)\s*%$/;

export type DutyRateKind = "free" | "adValorem" | "notAdValorem" | "notRecorded";

export interface ParsedDutyRate {
  kind: DutyRateKind;
  /** Percentage points, present only when the rate is fully ad valorem. */
  percent: number | null;
  /** The text exactly as published, so the screen can show the real wording. */
  raw: string | null;
}

export function parseDutyRate(raw: unknown): ParsedDutyRate {
  if (typeof raw !== "string") return { kind: "notRecorded", percent: null, raw: null };

  const text = raw.trim();
  if (text === "") return { kind: "notRecorded", percent: null, raw: null };

  if (FREE_PATTERN.test(text)) return { kind: "free", percent: 0, raw: text };

  const match = AD_VALOREM_PATTERN.exec(text);
  if (match) {
    const percent = Number(match[1]);
    if (Number.isFinite(percent)) return { kind: "adValorem", percent, raw: text };
  }

  // Specific ("13.2c/kg") and compound ("6.5% + 3.5c/kg") rates depend on
  // quantity or weight, so they carry no percentage on their own.
  return { kind: "notAdValorem", percent: null, raw: text };
}

export interface DutyComparison {
  current: ParsedDutyRate;
  proposed: ParsedDutyRate;
  /** True only when both sides are percentages that can be subtracted. */
  comparable: boolean;
  /** Proposed minus current, in percentage points. Null when not comparable. */
  deltaPercent: number | null;
  /** Why the comparison could not be made, for display. Null when it could. */
  reason: string | null;
}

export function compareDutyRates(currentRaw: unknown, proposedRaw: unknown): DutyComparison {
  const current = parseDutyRate(currentRaw);
  const proposed = parseDutyRate(proposedRaw);

  const uncomparable = (reason: string): DutyComparison => ({
    current,
    proposed,
    comparable: false,
    deltaPercent: null,
    reason,
  });

  if (current.kind === "notRecorded" && proposed.kind === "notRecorded") {
    return uncomparable("Neither code has a duty rate on file.");
  }
  if (current.kind === "notRecorded") {
    return uncomparable("The current code has no duty rate on file.");
  }
  if (proposed.kind === "notRecorded") {
    return uncomparable("The proposed code has no duty rate on file.");
  }
  if (current.kind === "notAdValorem" || proposed.kind === "notAdValorem") {
    return uncomparable(
      "At least one rate is specific or compound, so the difference is not a percentage."
    );
  }

  // Both sides are free or ad valorem, so both carry a percentage.
  const delta = (proposed.percent ?? 0) - (current.percent ?? 0);

  return {
    current,
    proposed,
    comparable: true,
    // Guard against floating-point noise such as 6.5 - 2.5 = 3.9999999999999996.
    deltaPercent: Math.round(delta * 1e6) / 1e6,
    reason: null,
  };
}

/**
 * Additional programme duties recorded against a code. These are stored as a
 * flag plus a rate, and a flag set without a rate is reported as such rather
 * than being shown as zero.
 */
export interface AdditionalDutyInput {
  section301Applicable: boolean;
  section301AdditionalRate: unknown;
  section232Applicable: boolean;
  section232AdditionalRate: unknown;
}

export interface AdditionalDuty {
  programme: "Section 301" | "Section 232";
  percent: number | null;
}

export function additionalDuties(input: AdditionalDutyInput): AdditionalDuty[] {
  const out: AdditionalDuty[] = [];

  const toPercent = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    // Prisma Decimal is an object and is truthy even at zero, so it is converted
    // rather than tested for truthiness.
    const n = Number(value.toString());
    return Number.isFinite(n) ? n : null;
  };

  if (input.section301Applicable) {
    out.push({ programme: "Section 301", percent: toPercent(input.section301AdditionalRate) });
  }
  if (input.section232Applicable) {
    out.push({ programme: "Section 232", percent: toPercent(input.section232AdditionalRate) });
  }

  return out;
}

/**
 * Normalises an HTS code for lookup. Published codes are written with dots;
 * stored codes are not always. Only the digits are significant.
 */
export function htsDigits(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const digits = code.replace(/\D/g, "");
  return digits === "" ? null : digits;
}
