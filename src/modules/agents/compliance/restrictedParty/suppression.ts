// Restricted / Denied-Party Screening -- approved-party suppression.
//
// No new "approved party list" table exists or should exist (per the
// implementation plan, this is explicitly NOT SUBSCRIBER_PARTY_LIST) --
// suppression is driven entirely by a prior RestrictedPartyDisposition
// (APPROVED or FALSE_POSITIVE) recorded against the same
// (accountId, partyId, screeningEntityId) pairing. A suppressed match is
// never deleted or hidden -- it is flagged, so the full evidence trail
// survives even when a human has already judged it a false positive.
import type { RestrictedPartyMatchCandidate } from "./types";

/** Map of screeningEntityId -> the disposition id that suppresses it, for one party. */
export type ApprovedDispositionMap = Map<string, string>;

export function applySuppressions(
  matches: Array<Omit<RestrictedPartyMatchCandidate, "sequence" | "suppressedByApprovedParty" | "suppressingDispositionId">>,
  approvedDispositions: ApprovedDispositionMap
): Array<Omit<RestrictedPartyMatchCandidate, "sequence">> {
  return matches.map((match) => {
    const dispositionId = approvedDispositions.get(match.screeningEntityId) ?? null;
    return {
      ...match,
      suppressedByApprovedParty: dispositionId !== null,
      suppressingDispositionId: dispositionId,
    };
  });
}
