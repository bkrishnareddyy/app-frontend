import { describe, expect, it } from "vitest";

import { commonExtractedCurrency, extractedCurrency } from "@/modules/documents/extractedCurrency";

/**
 * Nothing on Shipment or ShipmentLineItem stores a currency, so every screen that
 * shows an amount had hardcoded a dollar sign. This account holds shipments in
 * EUR, GBP and USD at once, so that was not a cosmetic default -- it reported a
 * EUR invoice's 157,949 as dollars on both the shipment workspace and the
 * dashboard, and summed all three into one "$" figure.
 */
const doc = (currency: string | null) => ({
  extractedJson: JSON.stringify(currency === null ? {} : { tradeMetadata: { currency } }),
});

describe("the currency a document set declares", () => {
  it("reads the code the extractor recorded", () => {
    expect(extractedCurrency([doc("EUR")])).toBe("EUR");
  });

  it("normalises case and surrounding space", () => {
    expect(extractedCurrency([{ extractedJson: '{"tradeMetadata":{"currency":" eur "}}' }])).toBe("EUR");
  });

  it("accepts a code at the top level too", () => {
    expect(extractedCurrency([{ extractedJson: '{"currency":"GBP"}' }])).toBe("GBP");
  });

  it("returns null when no document declared one", () => {
    // Absent, not dollars. A shipment whose documents never stated a currency is
    // not thereby denominated in USD.
    expect(extractedCurrency([doc(null), { extractedJson: null }])).toBeNull();
    expect(extractedCurrency([])).toBeNull();
  });

  it("returns null when two documents disagree", () => {
    // Picking one of two conflicting codes is a claim the documents do not
    // support, and it would misstate every amount rendered from it.
    expect(extractedCurrency([doc("EUR"), doc("USD")])).toBeNull();
  });

  it("still resolves when the same code appears repeatedly", () => {
    expect(extractedCurrency([doc("EUR"), doc("EUR"), doc(null)])).toBe("EUR");
  });

  it("survives an unparseable extraction", () => {
    // Malformed stored JSON contributes no currency rather than throwing on a
    // dashboard render.
    expect(extractedCurrency([{ extractedJson: "{not json" }, doc("USD")])).toBe("USD");
  });
});

describe("the currency a total may be labelled with", () => {
  it("labels a total only when every shipment shares one currency", () => {
    expect(commonExtractedCurrency([{ currency: "EUR" }, { currency: "EUR" }])).toBe("EUR");
  });

  it("refuses to label a mixed-currency total", () => {
    // Adding EUR to USD produces a number that denominates nothing. Every account
    // in this database mixes currencies, so this is the normal case, not an edge.
    expect(commonExtractedCurrency([{ currency: "EUR" }, { currency: "USD" }])).toBeNull();
  });

  it("ignores shipments with no declared currency when the rest agree", () => {
    expect(commonExtractedCurrency([{ currency: "USD" }, { currency: null }])).toBe("USD");
  });

  it("returns null for an empty set", () => {
    expect(commonExtractedCurrency([])).toBeNull();
  });
});
