// Country Embargo Screening -- classification parsing.
//
// Source classification types, pipe-delimited per line, e.g.
// "HTS|8501.10|CCL|3A001|SCHB|8501.10.0000":
//   CCL  -> ECCN
//   HTS  -> HTS
//   SCHB -> Schedule B
//
// Missing values are never fabricated -- absent tokens are simply omitted.
import type { ParsedClassification } from "./types";

const TYPE_TO_KEY: Record<string, keyof ParsedClassification> = {
  CCL: "eccn",
  HTS: "hts",
  SCHB: "scheduleB",
};

/**
 * Parses a pipe-delimited "TYPE|VALUE|TYPE|VALUE..." classification string.
 * ECCN absence must never prevent base country screening -- callers treat
 * `eccn` as purely optional.
 */
export function parseClassification(raw: string | null | undefined): ParsedClassification {
  const result: ParsedClassification = {};
  if (!raw) return result;

  const tokens = raw.split("|").map((t) => t.trim()).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i += 2) {
    const type = tokens[i].toUpperCase();
    const value = tokens[i + 1];
    const key = TYPE_TO_KEY[type];
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}
