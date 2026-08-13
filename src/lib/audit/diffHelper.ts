const REDACT_KEYS = new Set([
  "password",
  "token",
  "secret",
  "key",
  "apiKey",
  "checksum",
  "passcode",
]);

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key.toLowerCase())) {
    return "[REDACTED]";
  }
  return value;
}

export interface FieldDiff {
  previousValue: unknown;
  newValue: unknown;
}

export type RedactedDiff = Record<string, FieldDiff>;

/**
 * Computes a redacted diff between two objects, excluding sensitive keys.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): RedactedDiff {
  const result: RedactedDiff = {};
  if (!before || !after) return result;

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const k of allKeys) {
    const valBefore = before[k];
    const valAfter = after[k];

    if (JSON.stringify(valBefore) !== JSON.stringify(valAfter)) {
      result[k] = {
        previousValue: redactValue(k, valBefore),
        newValue: redactValue(k, valAfter),
      };
    }
  }

  return result;
}
