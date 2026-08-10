/**
 * Honest display helpers.
 *
 * Missing data must read as missing. A real `0` must always render as `0`, so
 * these helpers branch on null/undefined only — never on falsiness.
 */

export const NOT_PROVIDED = "Not provided";
export const NOT_CALCULATED = "Not calculated";
export const AWAITING_PROCESSING = "Awaiting processing";

export function isMissing(value: unknown): value is null | undefined {
  return value === null || value === undefined || value === "";
}

/** Renders a text value, or an explicit missing-state label. */
export function displayText(
  value: string | null | undefined,
  fallback: string = NOT_PROVIDED
): string {
  return isMissing(value) ? fallback : value;
}

/** Renders a percentage. `0` renders as "0%"; null renders as "Not calculated". */
export function displayPercent(
  value: number | null | undefined,
  fallback: string = NOT_CALCULATED
): string {
  return value === null || value === undefined ? fallback : `${Math.round(value)}%`;
}

/** Renders a numeric value. `0` renders as "0". */
export function displayNumber(
  value: number | null | undefined,
  fallback: string = NOT_CALCULATED
): string {
  return value === null || value === undefined ? fallback : String(value);
}

/** Renders a monetary amount. `0` renders as a real zero amount. */
export function displayCurrency(
  value: number | string | null | undefined,
  currency: string = "USD",
  fallback: string = NOT_CALCULATED
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return fallback;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(numeric);
}

/** Renders a date, or an explicit missing-state label. */
export function displayDate(
  value: Date | string | null | undefined,
  fallback: string = NOT_PROVIDED
): string {
  if (isMissing(value)) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Averages a set of values, ignoring entries that have not been calculated.
 * Returns null when nothing has been calculated yet, so callers can show
 * "Not calculated" instead of inventing a number.
 */
export function averageOfKnown(values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => v !== null && v !== undefined);
  if (known.length === 0) return null;
  return Math.round(known.reduce((total, v) => total + v, 0) / known.length);
}
