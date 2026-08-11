import { describe, expect, it } from "vitest";

import { LINE_ITEM_SENTINELS, isPlaceholderValue } from "@/modules/shipment/lineItemReconciler";

/**
 * ReconciliationEngine raised "Quantity could not be extracted for 20 line
 * item(s)" against an invoice whose every line had been read correctly. It
 * decided a field was a placeholder by comparing the stored value to the
 * sentinel, and the sentinel for an unknown quantity is 1 -- so all twenty lines
 * that legitimately shipped a single unit were indistinguishable from it.
 *
 * A false compliance exception is worse than none: it trains operators to click
 * past the warnings that are real.
 */
describe("recognising a placeholder line-item value", () => {
  it("keeps the sentinels in-band, which is why the value alone cannot decide", () => {
    // Guards the premise. If either of these stops being an ordinary declared
    // value, the fact check below is no longer load-bearing.
    expect(LINE_ITEM_SENTINELS.quantity).toBe(1);
    expect(LINE_ITEM_SENTINELS.unitPrice).toBe(0);
  });

  it("does not flag a real single unit that a source reported", () => {
    expect(isPlaceholderValue("quantity", 1, true)).toBe(false);
  });

  it("flags a quantity of 1 that no source ever reported", () => {
    expect(isPlaceholderValue("quantity", 1, false)).toBe(true);
  });

  it("does not flag a genuine free-of-charge line", () => {
    // Unit price 0 collides with the sentinel the same way quantity 1 does.
    expect(isPlaceholderValue("unitPrice", 0, true)).toBe(false);
    expect(isPlaceholderValue("unitPrice", 0, false)).toBe(true);
  });

  it("never flags a value that differs from the sentinel", () => {
    // Not extracted and not the placeholder either: whatever it is, it is not
    // this check's business.
    expect(isPlaceholderValue("quantity", 247, false)).toBe(false);
    expect(isPlaceholderValue("unitPrice", 298, false)).toBe(false);
    expect(isPlaceholderValue("countryOfOrigin", "PE", false)).toBe(false);
  });

  it("treats the placeholder country as missing only when unreported", () => {
    expect(isPlaceholderValue("countryOfOrigin", LINE_ITEM_SENTINELS.countryOfOrigin, false)).toBe(true);
    expect(isPlaceholderValue("countryOfOrigin", LINE_ITEM_SENTINELS.countryOfOrigin, true)).toBe(false);
  });

  it("accepts a Decimal-like unit price without pre-conversion", () => {
    expect(isPlaceholderValue("unitPrice", { toString: () => "0" }, false)).toBe(true);
  });
});
