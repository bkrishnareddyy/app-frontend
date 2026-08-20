// Restricted / Denied-Party Screening -- persistence.
//
// Writes one immutable RestrictedPartyScreeningResult row per pass, plus its
// matches and red-flag hits, in a single transaction. Never updates an
// existing row -- a re-screen always creates new rows, so history is never
// overwritten. A PENDING RestrictedPartyDisposition is created alongside
// every HIT/REVIEW_REQUIRED result so the reviewer queue has something to
// pick up; CLEAR/SKIPPED/ERROR results get no disposition (nothing to review).
import { db } from "@/lib/db";
import type { Prisma, RestrictedPartyScreeningResult } from "@prisma/client";
import type { RestrictedPartyScreeningInput, RestrictedPartyScreeningRunResult } from "./types";

export type PersistedRestrictedPartyResult = RestrictedPartyScreeningResult & {
  matches: Prisma.RestrictedPartyMatchGetPayload<{ include: { screeningEntity: { select: { sourcePublishedAt: true } } } }>[];
  redFlagHits: Prisma.RestrictedPartyRedFlagHitGetPayload<Record<string, never>>[];
};

export async function persistScreeningRun(
  input: RestrictedPartyScreeningInput,
  runResult: RestrictedPartyScreeningRunResult
): Promise<PersistedRestrictedPartyResult[]> {
  return db.$transaction(async (tx) => {
    const created: PersistedRestrictedPartyResult[] = [];

    for (const pass of runResult.passes) {
      const row = await tx.restrictedPartyScreeningResult.create({
        data: {
          accountId: input.accountId,
          correlationId: runResult.correlationId,
          source: input.source,
          shipmentId: input.shipmentId ?? null,
          lineItemId: input.lineItemId ?? null,
          partyId: input.partyId ?? null,
          externalReference: input.externalReference ?? null,
          passType: pass.passType,
          screenedName: pass.screenedName,
          screenedAddress: pass.screenedAddress,
          screenedCity: pass.screenedCity,
          screenedCountry: pass.screenedCountry,
          nameThreshold: pass.nameThreshold,
          addressThreshold: pass.addressThreshold,
          countryMatchRequired: pass.countryMatchRequired,
          redFlagCheckEnabled: pass.redFlagCheckEnabled,
          status: pass.status,
          hitCount: pass.matches.filter((m) => !m.suppressedByApprovedParty).length,
          redFlagCount: pass.redFlagHits.length,
          errorCode: pass.errorCode,
          errorMessage: pass.errorMessage,
          screeningInputHash: pass.screeningInputHash,
          screeningDate: input.screeningDate ?? new Date(),
          screeningDurationMs: pass.screeningDurationMs,
          matches: {
            create: pass.matches.map((m) => ({
              sequence: m.sequence,
              screeningEntityId: m.screeningEntityId,
              matchedName: m.matchedName,
              matchedAddress: m.matchedAddress,
              nameScore: m.nameScore,
              addressScore: m.addressScore,
              matchMethod: m.matchMethod,
              countryMatch: m.countryMatch,
              sourceList: m.sourceList,
              entityType: m.entityType,
              programCodes: m.programCodes,
              citation: m.citation,
              agency: m.agency,
              effectiveDate: m.effectiveDate,
              expirationDate: m.expirationDate,
              suppressedByApprovedParty: m.suppressedByApprovedParty,
              suppressingDispositionId: m.suppressingDispositionId,
            })),
          },
          redFlagHits: {
            create: pass.redFlagHits.map((h) => ({
              keywordRuleId: h.keywordRuleId,
              matchedWord: h.matchedWord,
            })),
          },
          ...(pass.status === "HIT" || pass.status === "REVIEW_REQUIRED"
            ? { disposition: { create: { accountId: input.accountId, status: "PENDING" } } }
            : {}),
        },
        include: {
          matches: { include: { screeningEntity: { select: { sourcePublishedAt: true } } } },
          redFlagHits: true,
        },
      });
      created.push(row);
    }

    return created;
  });
}
