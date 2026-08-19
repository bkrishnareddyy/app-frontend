import type { TariffLineInput } from "@/lib/tariff/dutyEngine";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";

export interface FilingCurrencyContext {
  commercialCurrency: string;
  customsCurrency: string;
  exchangeRate: number;
  exchangeRateSource: string;
  exchangeRateEffectiveDate: string;
}

export interface CurrencyContextContainer {
  currencyContext?: Partial<FilingCurrencyContext> | null;
}

const CUSTOMS_CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD", CA: "CAD", MX: "MXN", GB: "GBP", JP: "JPY", CN: "CNY", IN: "INR",
  AU: "AUD", NZ: "NZD", CH: "CHF", NO: "NOK", SE: "SEK", DK: "DKK", PL: "PLN",
  CZ: "CZK", HU: "HUF", RO: "RON", KR: "KRW", SG: "SGD", HK: "HKD", BR: "BRL",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  IE: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", MT: "EUR", CY: "EUR",
  EE: "EUR", LV: "EUR", LT: "EUR", SK: "EUR", SI: "EUR", HR: "EUR",
};

export function normalizeCurrencyCode(value: unknown, fallback?: string): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  if (fallback) return normalizeCurrencyCode(fallback);
  throw new Error("Currency must be a 3-letter ISO 4217 code");
}

export function getCustomsValuationCurrency(country?: string | null): string {
  const normalized = country?.trim().toUpperCase() || "US";
  const currency = CUSTOMS_CURRENCY_BY_COUNTRY[normalized];
  if (!currency) {
    throw new Error(`Customs valuation currency is not configured for jurisdiction ${normalized}; set it explicitly before filing`);
  }
  return currency;
}

export function resolveFilingCurrencyContext(
  country: string | null | undefined,
  container: CurrencyContextContainer | null | undefined
): FilingCurrencyContext {
  const configuredCustomsCurrency = container?.currencyContext?.customsCurrency;
  const customsCurrency = configuredCustomsCurrency
    ? normalizeCurrencyCode(configuredCustomsCurrency)
    : getCustomsValuationCurrency(country);
  const commercialCurrency = normalizeCurrencyCode(container?.currencyContext?.commercialCurrency, customsCurrency);
  const requiresConversion = commercialCurrency !== customsCurrency;
  const rateRaw = Number(container?.currencyContext?.exchangeRate ?? (requiresConversion ? NaN : 1));
  if (!Number.isFinite(rateRaw) || rateRaw <= 0) {
    throw new Error(`A positive exchange rate is required to convert ${commercialCurrency} to ${customsCurrency}`);
  }
  const source = String(container?.currencyContext?.exchangeRateSource ?? (requiresConversion ? "" : "IDENTITY")).trim();
  if (!source) throw new Error("Exchange-rate source is required when commercial and customs currencies differ");
  const effectiveDateRaw = String(container?.currencyContext?.exchangeRateEffectiveDate ?? (requiresConversion ? "" : new Date().toISOString())).trim();
  if (!effectiveDateRaw) throw new Error("Exchange-rate effective date is required when commercial and customs currencies differ");
  const effectiveDate = new Date(effectiveDateRaw);
  if (Number.isNaN(effectiveDate.getTime())) throw new Error("Exchange-rate effective date is invalid");
  return {
    commercialCurrency,
    customsCurrency,
    exchangeRate: rateRaw,
    exchangeRateSource: source,
    exchangeRateEffectiveDate: effectiveDate.toISOString(),
  };
}

export function convertCurrencyAmount(amount: number, context: FilingCurrencyContext): number {
  if (!Number.isFinite(amount)) throw new Error("Currency amount must be finite");
  return roundToCents(new Decimal(amount).times(new Decimal(context.exchangeRate))).toNumber();
}

export function convertTariffLines(lines: TariffLineInput[], context: FilingCurrencyContext): TariffLineInput[] {
  if (context.commercialCurrency === context.customsCurrency) return lines.map((line) => ({ ...line }));
  return lines.map((line) => ({
    ...line,
    unitPrice: line.unitPrice == null ? line.unitPrice : convertCurrencyAmount(Number(line.unitPrice), context),
    totalValue: line.totalValue == null ? line.totalValue : convertCurrencyAmount(Number(line.totalValue), context),
  }));
}
