// End-User Screening -- deterministic orchestrator.
//
// Fuzzy-matches transaction party names against the BIS Entity List /
// Unverified List. Status derivation mirrors forcedLaborScreening.ts's
// entity-list check.
import { scoreDpsMatch, scoreToMatchStatus } from "@/lib/screening/dpsScreening";
import { getEndUserEntityList } from "./endUserRepository";
import type { EndUserScreeningInput, EndUserScreeningResult, EndUserHit, EndUserSkip, EndUserError } from "./types";

export async function runEndUserScreening(input: EndUserScreeningInput): Promise<EndUserScreeningResult> {
  const hits: EndUserHit[] = [];
  const skipped: EndUserSkip[] = [];
  const errors: EndUserError[] = [];
  let checksRun = 0;

  let entityList: Awaited<ReturnType<typeof getEndUserEntityList>> = [];
  try {
    entityList = await getEndUserEntityList();
  } catch (err) {
    errors.push({ code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (errors.length === 0) {
    if (entityList.length === 0) {
      skipped.push({ reason: "No BIS Entity List / Unverified List reference data is loaded (ScreeningEntity table has no published ENTITY_LIST/UNVERIFIED rows)." });
    } else {
      for (const target of input.entityNames) {
        if (!target.name || !target.name.trim()) {
          skipped.push({ reason: "No name available to screen.", role: target.role });
          continue;
        }
        checksRun++;
        let bestScore = 0;
        let bestEntity: (typeof entityList)[number] | null = null;
        for (const entity of entityList) {
          const score = scoreDpsMatch(target.name, entity.name);
          if (score > bestScore) {
            bestScore = score;
            bestEntity = entity;
          }
        }
        const rawMatchStatus = scoreToMatchStatus(bestScore);
        if (bestEntity && (rawMatchStatus === "FLAGGED" || rawMatchStatus === "BLOCKED")) {
          const matchStatus = rawMatchStatus;
          hits.push({
            role: target.role,
            targetName: target.name,
            matchedEntityName: bestEntity.name,
            matchScore: bestScore,
            matchStatus,
            entityId: bestEntity.id,
            sourceList: bestEntity.sourceList,
            programCodes: bestEntity.programCodes,
            reason: `${target.role} "${target.name}" ${matchStatus === "BLOCKED" ? "matches" : "closely resembles"} ${bestEntity.sourceList} entry "${bestEntity.name}" (score ${bestScore}/100). End-use/end-user due-diligence documentation required before release.`,
          });
        }
      }
    }
  }

  const hasHits = hits.length > 0;
  const hasErrors = errors.length > 0;

  let status: EndUserScreeningResult["status"];
  if (hasHits && hasErrors) status = "PARTIAL";
  else if (hasHits) status = "HIT";
  else if (hasErrors) status = "ERROR";
  else if (checksRun === 0) status = "SKIPPED";
  else status = "CLEAR";

  return { status, hits, skipped, errors, checksRun };
}
