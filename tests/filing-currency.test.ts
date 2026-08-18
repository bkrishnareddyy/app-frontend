import { describe, expect, it } from "vitest";
import {
  convertCurrencyAmount,
  convertTariffLines,
  getCustomsValuationCurrency,
  resolveFilingCurrencyContext,
} from "@/lib/canonicalMessaging/currencyContext";
import { extractedCurrencies, extractedCurrency } from "@/modules/documents/extractedCurrency";

describe("filing currency context", () => {
  it("uses identity conversion when commercial and customs currencies match", () => {
    const context = resolveFilingCurrencyContext("US", {
      currencyContext: { commercialCurrency: "USD" },
    });

    expect(context).toMatchObject({
      commercialCurrency: "USD",
      customsCurrency: "USD",
      exchangeRate: 1,
      exchangeRateSource: "IDENTITY",
    });
  });

  it("requires an explicit rate for cross-currency customs valuation", () => {
    expect(() =>
      resolveFilingCurrencyContext("US", {
        currencyContext: { commercialCurrency: "EUR", customsCurrency: "USD" },
      })
    ).toThrow(/positive exchange rate/i);
  });

  it("requires an effective date for cross-currency customs valuation", () => {
    expect(() =>
      resolveFilingCurrencyContext("US", {
        currencyContext: {
          commercialCurrency: "EUR",
          customsCurrency: "USD",
          exchangeRate: 1.1642,
          exchangeRateSource: "CBP WEEKLY RATE",
        },
      })
    ).toThrow(/effective date/i);
  });

  it("freezes rate source and effective date for cross-currency valuation", () => {
    const context = resolveFilingCurrencyContext("US", {
      currencyContext: {
        commercialCurrency: "EUR",
        customsCurrency: "USD",
        exchangeRate: 1.1642,
        exchangeRateSource: "CBP WEEKLY RATE",
        exchangeRateEffectiveDate: "2026-08-17T00:00:00.000Z",
      },
    });

    expect(context.exchangeRate).toBe(1.1642);
    expect(context.exchangeRateSource).toBe("CBP WEEKLY RATE");
    expect(context.exchangeRateEffectiveDate).toBe("2026-08-17T00:00:00.000Z");
    expect(convertCurrencyAmount(10000, context)).toBe(11642);
  });

  it("converts tariff copies without changing original commercial values", () => {
    const original = [{
      htsCode: "8481805090",
      countryOfOrigin: "DE",
      quantity: 2,
      unitPrice: 5000,
      totalValue: 10000,
    }];
    const context = resolveFilingCurrencyContext("US", {
      currencyContext: {
        commercialCurrency: "EUR",
        customsCurrency: "USD",
        exchangeRate: 1.1642,
        exchangeRateSource: "CBP WEEKLY RATE",
        exchangeRateEffectiveDate: "2026-08-17T00:00:00.000Z",
      },
    });

    const converted = convertTariffLines(original, context);

    expect(original[0].unitPrice).toBe(5000);
    expect(original[0].totalValue).toBe(10000);
    expect(Number(converted[0].unitPrice)).toBe(5821);
    expect(Number(converted[0].totalValue)).toBe(11642);
  });

  it("uses the filing jurisdiction's valuation currency rather than invoice origin", () => {
    expect(getCustomsValuationCurrency("US")).toBe("USD");
    expect(getCustomsValuationCurrency("NL")).toBe("EUR");
    expect(getCustomsValuationCurrency("GB")).toBe("GBP");
  });

  it("fails closed when jurisdiction currency is unknown", () => {
    expect(() => getCustomsValuationCurrency("ZZ")).toThrow(/not configured/i);
  });

  it("allows an explicit customs currency for an otherwise unknown jurisdiction", () => {
    const context = resolveFilingCurrencyContext("ZZ", {
      currencyContext: {
        commercialCurrency: "USD",
        customsCurrency: "USD",
      },
    });
    expect(context.customsCurrency).toBe("USD");
  });
});

describe("extracted filing currency evidence", () => {
  it("returns a single agreed document currency", () => {
    const documents = [
      { extractedJson: JSON.stringify({ tradeMetadata: { currency: "EUR" } }) },
      { extractedJson: JSON.stringify({ keyValuePairs: { Currency: "EUR" } }) },
    ];
    expect(extractedCurrencies(documents)).toEqual(["EUR"]);
    expect(extractedCurrency(documents)).toBe("EUR");
  });

  it("preserves conflicting document currencies for filing review", () => {
    const documents = [
      { extractedJson: JSON.stringify({ currency: "EUR" }) },
      { extractedJson: JSON.stringify({ currency: "USD" }) },
    ];
    expect(extractedCurrencies(documents)).toEqual(["EUR", "USD"]);
    expect(extractedCurrency(documents)).toBeNull();
  });
});
