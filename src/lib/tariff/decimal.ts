import { Decimal } from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function roundToCents(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** For JSON serialization only — never use for further arithmetic. */
export function toNumber(d: Decimal): number {
  return d.toNumber();
}

export function fromString(s: string): Decimal {
  return new Decimal(s);
}
