// Restricted / Denied-Party Screening -- scoring.
//
// Wraps scoreDpsMatch (src/lib/screening/dpsScreening.ts, the codebase's one
// deterministic fuzzy scorer, already reused unmodified by
// forcedLaborScreening.ts/endUserScreening.ts) with stop-word-stripped
// inputs, an optional separate address-score gate, and an optional
// country-match gate. Never produces a candidate below REVIEW_FLOOR_SCORE --
// that is discarded as noise, not surfaced as a low-confidence match.
import { scoreDpsMatch } from "@/lib/screening/dpsScreening";
import { normalizeForMatching } from "./normalize";
import { REVIEW_FLOOR_SCORE } from "./types";
import type { RestrictedPartyMatchCandidate, RestrictedPartyMatchMethod } from "./types";
import type { CandidateReason, ScreeningCandidate } from "./candidateGeneration";

function methodFromReasons(reasons: Set<CandidateReason>): RestrictedPartyMatchMethod {
  if (reasons.has("EXACT")) return "EXACT";
  const hasRawWord = reasons.has("RAW_WORD");
  const hasPhonetic = reasons.has("DOUBLE_METAPHONE");
  if (hasRawWord && hasPhonetic) return "COMBINED";
  if (hasRawWord) return "RAW_WORD";
  return "DOUBLE_METAPHONE";
}

export interface ScoreMatchOptions {
  targetName: string;
  targetAddress?: string | null;
  targetCountry?: string | null;
  nameThreshold: number;
  addressThreshold?: number | null;
  countryMatchRequired: boolean;
}

/** Scores one shortlisted candidate; returns null when it falls below REVIEW_FLOOR_SCORE (not worth surfacing). Sequence is assigned by the caller once the final ordered list is known. */
export function scoreCandidate(
  candidate: ScreeningCandidate,
  options: ScoreMatchOptions
): Omit<RestrictedPartyMatchCandidate, "sequence" | "suppressedByApprovedParty" | "suppressingDispositionId"> | null {
  const nameScore = scoreDpsMatch(normalizeForMatching(options.targetName), normalizeForMatching(candidate.matchedAgainst));
  if (nameScore < REVIEW_FLOOR_SCORE) return null;

  let tier: "HIT" | "REVIEW_REQUIRED" = nameScore >= options.nameThreshold ? "HIT" : "REVIEW_REQUIRED";

  let addressScore: number | null = null;
  if (options.addressThreshold != null && options.targetAddress && candidate.entity.address) {
    addressScore = scoreDpsMatch(options.targetAddress, candidate.entity.address);
    if (tier === "HIT" && addressScore < options.addressThreshold) tier = "REVIEW_REQUIRED";
  }

  let countryMatch: boolean | null = null;
  if (options.targetCountry && candidate.entity.country) {
    countryMatch = normalizeForMatching(options.targetCountry) === normalizeForMatching(candidate.entity.country);
  }
  if (options.countryMatchRequired && tier === "HIT" && countryMatch !== true) {
    tier = "REVIEW_REQUIRED";
  }

  return {
    screeningEntityId: candidate.entity.id,
    matchedName: candidate.entity.name,
    matchedAddress: candidate.entity.address,
    nameScore,
    addressScore,
    matchMethod: methodFromReasons(candidate.reasons),
    countryMatch,
    sourceList: candidate.entity.sourceList,
    entityType: candidate.entity.entityType,
    programCodes: candidate.entity.programCodes,
    tier,
  };
}
