/**
 * Shared "most specific match wins" resolution for the canonical-messaging
 * reference tables (FilingProcedureMapping, FilingMessageCatalog,
 * FilingResponseStatusMapping, FilingActionRule). Each of those tables
 * lets any of its key columns be the literal string "*" as a wildcard
 * fallback; this picks the candidate with the fewest wildcards among the
 * rows that actually match, so a country-specific row always beats a
 * default row.
 */
export function findMostSpecificMatch<T>(
  candidates: T[],
  fields: (keyof T)[],
  target: Record<string, string>
): T | null {
  let best: T | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    let matches = true;
    let score = 0;
    for (const field of fields) {
      const value = candidate[field] as unknown as string;
      if (value === "*") continue;
      if (value !== target[field as string]) {
        matches = false;
        break;
      }
      score++;
    }
    if (matches && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
