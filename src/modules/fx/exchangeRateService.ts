import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export class ExchangeRateService {
  /**
   * Fetches the latest USD-based rates from CurrencyFreaks and stores them as
   * the new current rate per currency. No DRAFT/PENDING staging -- unlike
   * AdCvdCompanyRate (LLM-extracted, needs human review), this is a direct
   * machine-readable API response with no judgment call involved.
   */
  static async fetchAndStoreRates(): Promise<{ success: boolean; count: number; note: string }> {
    const apiKey = process.env.CURRENCYFREAKS_API_KEY || "";
    const url = new URL("https://api.currencyfreaks.com/v2.0/rates/latest");
    if (apiKey) url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`CurrencyFreaks API returned HTTP ${res.status}: ${res.statusText}. FX rate refresh aborted.`);
    }

    const json = await res.json();
    const rates: Record<string, string> = json.rates || {};
    const currencyCodes = Object.keys(rates);
    const now = new Date();

    let count = 0;
    for (const currencyCode of currencyCodes) {
      const usdPerUnit = parseFloat(rates[currencyCode]);
      if (!Number.isFinite(usdPerUnit) || usdPerUnit <= 0) continue;

      // CurrencyFreaks returns "units of currencyCode per 1 USD" -- invert so
      // downstream math is a plain multiply: usdAmount = foreignAmount * rateToUsd.
      const rateToUsd = new Prisma.Decimal(1).div(usdPerUnit);

      await db.exchangeRate.updateMany({
        where: { currencyCode, isCurrent: true },
        data: { isCurrent: false },
      });
      await db.exchangeRate.create({
        data: { currencyCode, rateToUsd, fetchedAt: now, isCurrent: true },
      });
      count++;
    }

    return {
      success: true,
      count,
      note: `Fetched and stored current exchange rates for ${count} currencies from CurrencyFreaks.`,
    };
  }

  /**
   * Resolves the USD conversion rate for a currency code. Returns 1 for
   * USD/null/undefined without a query. Fails closed -- if no stored rate
   * exists, throws rather than silently defaulting to 1, since that would
   * reintroduce the exact silent-assume-USD bug this service exists to close.
   *
   * Without `asOfDate`, resolves the current (`isCurrent: true`) rate.
   *
   * With `asOfDate` (e.g. a shipment's date of export, per 19 CFR 159.34),
   * resolves the rate as it stood on that date -- the latest ingested row
   * with `fetchedAt <= asOfDate` -- using the daily supersede-history that
   * fetchAndStoreRates() already accumulates (each refresh keeps the prior
   * row rather than deleting it). If no row exists at or before that date
   * (e.g. the shipment predates this service's first ingestion run), throws
   * rather than approximating with the current rate or the earliest
   * available one.
   */
  static async resolveExchangeRate(
    currencyCode: string | null | undefined,
    asOfDate?: Date | null
  ): Promise<Prisma.Decimal> {
    if (!currencyCode || currencyCode === "USD") {
      return new Prisma.Decimal(1);
    }

    const row = asOfDate
      ? await db.exchangeRate.findFirst({
          where: { currencyCode, fetchedAt: { lte: asOfDate } },
          orderBy: { fetchedAt: "desc" },
        })
      : await db.exchangeRate.findFirst({
          where: { currencyCode, isCurrent: true },
        });

    if (!row) {
      const suffix = asOfDate
        ? ` as of ${asOfDate.toISOString().slice(0, 10)} -- no ingested rate exists at or before that date`
        : " -- run fx-rate-refresh first";
      throw new Error(`No exchange rate available for currency ${currencyCode}${suffix}.`);
    }

    return row.rateToUsd;
  }
}
