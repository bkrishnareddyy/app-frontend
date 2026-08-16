// Restricted / Denied-Party Screening -- candidate generation.
//
// Pure functions -- no DB. Given a normalized screened name and a pre-fetched
// reference list, shortlists ScreeningEntity rows worth scoring: an exact
// normalized-name match, a shared significant raw word, or a phonetic
// (Double Metaphone) collision. Scoring itself (scoring.ts) decides whether a
// shortlisted candidate clears any threshold -- this stage only decides what
// is worth scoring at all, so it must never be the source of a false CLEAR.
import { normalizeForMatching, tokenize } from "./normalize";
import { doubleMetaphoneMatches } from "./phoneticMatch";
import type { ScreeningEntity } from "@prisma/client";

export type CandidateReason = "EXACT" | "RAW_WORD" | "DOUBLE_METAPHONE";

export interface ScreeningCandidate {
  entity: ScreeningEntity;
  matchedAgainst: string; // the entity name/alternateName that triggered the shortlist
  reasons: Set<CandidateReason>;
}

function candidateNames(entity: ScreeningEntity): string[] {
  return [entity.name, ...entity.alternateNames];
}

/** Shortlists reference entities worth scoring against `targetRawName`. Never returns duplicates per entity. */
export function generateCandidates(targetRawName: string, referenceList: ScreeningEntity[]): ScreeningCandidate[] {
  const targetNormalized = normalizeForMatching(targetRawName);
  const targetTokens = new Set(tokenize(targetNormalized));

  const byEntityId = new Map<string, ScreeningCandidate>();

  for (const entity of referenceList) {
    for (const rawName of candidateNames(entity)) {
      if (!rawName || !rawName.trim()) continue;
      const entityNormalized = normalizeForMatching(rawName);
      const entityTokens = tokenize(entityNormalized);

      let reason: CandidateReason | null = null;
      if (entityNormalized === targetNormalized && targetNormalized.length > 0) {
        reason = "EXACT";
      } else if (entityTokens.some((t) => t.length > 3 && targetTokens.has(t))) {
        reason = "RAW_WORD";
      } else if (doubleMetaphoneMatches(targetNormalized, entityNormalized)) {
        reason = "DOUBLE_METAPHONE";
      }

      if (reason) {
        const existing = byEntityId.get(entity.id);
        if (existing) {
          existing.reasons.add(reason);
        } else {
          byEntityId.set(entity.id, { entity, matchedAgainst: rawName, reasons: new Set([reason]) });
        }
      }
    }
  }

  return Array.from(byEntityId.values());
}
