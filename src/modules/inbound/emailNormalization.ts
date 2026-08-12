/**
 * Normalizes a sender email address for inbound-route matching.
 *
 * Trims surrounding whitespace and lowercases the whole address. Deliberately
 * does NOT collapse Gmail dots, strip plus-tags, or otherwise treat distinct
 * addresses as equivalent -- two different addresses must never silently
 * match the same route.
 */
export function normalizeSenderEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * True if `candidate` (a raw "To"/"received_for" address from the provider)
 * matches `expected` (an already-normalized configured recipient) after the
 * same normalization.
 */
export function recipientMatches(candidate: string, expected: string): boolean {
  return normalizeSenderEmail(candidate) === expected;
}
