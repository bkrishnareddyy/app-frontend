/**
 * Phase 0 of F15 (Evals & AI Quality Intelligence). Pure function, no DB
 * access -- mirrors the split the billing plan (F14) established between
 * pure scoring logic and DB-touching orchestration, so this stays testable
 * without a live database and reusable once Phase 1 wires it into a runner.
 *
 * A case's `expected` code is only as many digits deep as whoever authored
 * it could actually defend (see docs/requirements/evals-ai-quality-intelligence.md
 * §0 -- most of this codebase's real AgentDecision rows have never been
 * human-reviewed, so Phase 0's golden set is deliberately truncated to
 * heading/subheading precision instead of claiming false 10-digit certainty).
 * "Passed" means actual matches expected to its full asserted depth, not
 * "matches to 10 digits" -- scoring beyond what was actually verified would
 * be exactly the kind of fabricated confidence this whole feature exists to
 * catch elsewhere.
 */

export type HtsMatchLevel = "10" | "8" | "6" | "4" | "none";

export interface HtsMatchResult {
  /** Digit-depth the case's expected value actually asserts (4, 6, 8, or 10). */
  targetLevel: Exclude<HtsMatchLevel, "none">;
  /** Deepest level, at or below targetLevel, where actual matches expected. */
  matchedLevel: HtsMatchLevel;
  score: number;
  passed: boolean;
}

const SCORE_BY_LEVEL: Record<HtsMatchLevel, number> = {
  "10": 1.0,
  "8": 0.8,
  "6": 0.5,
  "4": 0.2,
  none: 0,
};

const BOUNDARY_LEVELS: Array<Exclude<HtsMatchLevel, "none">> = ["10", "8", "6", "4"];

function normalizeDigits(code: string): string {
  return code.replace(/[^0-9]/g, "");
}

/**
 * Compares an expected HTS code (of whatever depth the case can defend)
 * against the agent's actual proposed code. `actual: null` covers both "no
 * decision produced" and the agent's own `UNCLASSIFIABLE` sentinel --
 * both are a full miss, not a special case.
 */
export function scoreHtsMatch(expected: string, actual: string | null): HtsMatchResult {
  const expectedDigits = normalizeDigits(expected);
  const targetLevel = BOUNDARY_LEVELS.find((level) => expectedDigits.length >= Number(level));

  if (!targetLevel) {
    throw new Error(
      `scoreHtsMatch: expected code "${expected}" has fewer than 4 digits -- not a usable HTS heading.`
    );
  }

  if (!actual || actual.trim().toUpperCase() === "UNCLASSIFIABLE") {
    return { targetLevel, matchedLevel: "none", score: 0, passed: false };
  }

  const actualDigits = normalizeDigits(actual);
  const expectedPrefix = expectedDigits.slice(0, Number(targetLevel));

  let matchedLevel: HtsMatchLevel = "none";
  for (const level of BOUNDARY_LEVELS) {
    const depth = Number(level);
    if (depth > Number(targetLevel)) continue; // never claim credit beyond what's verified
    if (actualDigits.slice(0, depth) === expectedPrefix.slice(0, depth)) {
      matchedLevel = level;
      break;
    }
  }

  return {
    targetLevel,
    matchedLevel,
    score: SCORE_BY_LEVEL[matchedLevel],
    passed: matchedLevel === targetLevel,
  };
}
