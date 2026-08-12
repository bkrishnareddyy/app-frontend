/**
 * The currency a set of documents is denominated in.
 *
 * Nothing on Shipment or ShipmentLineItem stores a currency, so the only honest
 * source is what the extractor read off the documents themselves. Shared because
 * the shipment workspace and the dashboard both render amounts and had both
 * hardcoded a dollar sign over figures that were not necessarily dollars.
 */

/** Reads the currency an extraction recorded, or null if it recorded none. */
function currencyOf(extractedJson: string | null | undefined): string | null {
  if (!extractedJson) return null;
  try {
    const parsed = JSON.parse(extractedJson);
    const raw =
      parsed?.tradeMetadata?.currency ??
      parsed?.currency ??
      parsed?.keyValuePairs?.currency ??
      parsed?.keyValuePairs?.Currency ??
      parsed?.keyValuePairs?.["Invoice Currency"] ??
      parsed?.keyValuePairs?.["Currency Code"];
    if (typeof raw !== "string" || !raw.trim()) return null;
    const clean = raw.trim().toUpperCase();
    if (clean.includes("GBP") || clean.includes("POUND") || clean.includes("£")) return "GBP";
    if (clean.includes("EUR") || clean.includes("EURO") || clean.includes("€")) return "EUR";
    if (clean.includes("USD") || clean.includes("DOLLAR") || clean.includes("$")) return "USD";
    if (clean.includes("CAD")) return "CAD";
    if (clean.includes("AUD")) return "AUD";
    if (clean.includes("JPY") || clean.includes("YEN") || clean.includes("¥")) return "JPY";
    if (clean.length === 3) return clean;
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the single currency these documents agree on, or null.
 *
 * Null when no document declared one AND when two disagree: a guessed currency
 * misstates every amount on the screen, and picking one of two conflicting codes
 * would be a claim the documents do not support. Callers render a bare number in
 * that case rather than an invented symbol.
 */
export function extractedCurrency(
  documents: ReadonlyArray<{ extractedJson?: string | null }>
): string | null {
  const found = new Set<string>();
  for (const doc of documents) {
    const code = currencyOf(doc.extractedJson);
    if (code !== null) found.add(code);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The single currency a whole collection of shipments agrees on, or null.
 *
 * Used for figures that sum across shipments. Such a total is only meaningful
 * when every contributing shipment is in the same currency — adding EUR to USD
 * produces a number that denominates nothing, so when they differ the caller
 * gets null and shows the sum unlabelled rather than stamping one currency on a
 * mixed-currency figure.
 */
export function commonExtractedCurrency(
  shipments: ReadonlyArray<{ currency?: string | null }>
): string | null {
  const found = new Set<string>();
  for (const shipment of shipments) {
    if (shipment.currency) found.add(shipment.currency);
  }
  return found.size === 1 ? [...found][0] : null;
}
