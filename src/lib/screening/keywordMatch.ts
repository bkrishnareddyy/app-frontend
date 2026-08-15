export interface KeywordRuleLike {
  phrase: string;
  matchType: string; // CONTAINS | EXACT | REGEX
}

/** True when `text` matches the rule's phrase per its matchType. Invalid REGEX rules never match (fail closed, not open). */
export function matchesKeyword(text: string | undefined | null, rule: KeywordRuleLike): boolean {
  if (!text) return false;
  const value = text.trim();
  if (!value) return false;
  const phrase = rule.phrase.trim();
  if (!phrase) return false;

  switch (rule.matchType) {
    case "EXACT":
      return value.toLowerCase() === phrase.toLowerCase();
    case "REGEX":
      try {
        return new RegExp(phrase, "i").test(value);
      } catch {
        return false;
      }
    case "CONTAINS":
    default:
      return value.toLowerCase().includes(phrase.toLowerCase());
  }
}

/** Every rule (from a pre-fetched list) that `text` matches against. */
export function screenText<T extends KeywordRuleLike>(text: string | undefined | null, rules: T[]): T[] {
  return rules.filter((rule) => matchesKeyword(text, rule));
}
