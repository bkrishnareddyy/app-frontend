export interface KeywordRuleLike {
  phrase: string;
  matchType: string; // CONTAINS | EXACT | REGEX
}

// REGEX rules run against document text of attacker/vendor-influenced length
// and content (endUseStatement, documentNarrativeText) on Node's single event
// loop, with no execution timeout available for a synchronous RegExp.test. A
// pattern with nested/overlapping quantifiers (e.g. "(a+)+", "(a|a)*") can
// force catastrophic backtracking and hang the whole process, not just this
// screening call. Rather than trying to sandbox execution, this fails closed
// on any pattern shaped like that risk, and bounds both the pattern and the
// input text so a false negative here is cheap, not a stalled server.
const MAX_REGEX_PATTERN_LENGTH = 200;
const MAX_REGEX_INPUT_LENGTH = 2000;
const NESTED_QUANTIFIER_PATTERN = /\([^)]*[+*][^)]*\)[+*]|\([^)]*\)[+*][^)]*\([^)]*\)[+*]/;

function isRegexPatternSafe(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  if (NESTED_QUANTIFIER_PATTERN.test(pattern)) return false;
  return true;
}

/** True when `text` matches the rule's phrase per its matchType. Invalid or unsafe REGEX rules never match (fail closed, not open). */
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
      if (!isRegexPatternSafe(phrase)) return false;
      try {
        return new RegExp(phrase, "i").test(value.slice(0, MAX_REGEX_INPUT_LENGTH));
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
