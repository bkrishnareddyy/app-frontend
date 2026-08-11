export interface EmbargoRuleLike {
  countryCode: string;
  countryName: string;
}

/** True when the supplied text names the rule's country or carries its ISO code. */
export function matchesRule(value: string | undefined | null, rule: EmbargoRuleLike): boolean {
  if (!value) return false;
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (text.includes(rule.countryName.toLowerCase())) return true;
  const code = rule.countryCode.toLowerCase();
  if (text === code) return true;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/** Every rule (from a pre-fetched list) that `value` matches against. */
export function screenValue<T extends EmbargoRuleLike>(value: string | undefined | null, rules: T[]): T[] {
  return rules.filter((rule) => matchesRule(value, rule));
}
