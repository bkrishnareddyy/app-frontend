// UFLPA / Forced Labor Screening -- deterministic orchestrator.
//
// Runs both the country/region rebuttable-presumption check and the entity-
// list check, and combines them into a single result. Neither check may ever
// resolve to CLEAR when its reference data is unloaded -- SKIPPED instead
// (see forcedLaborRepository.ts). Status derivation mirrors
// countryEmbargoScreening.ts: HIT-only -> HIT, HIT+ERROR -> PARTIAL,
// ERROR-only -> ERROR, no checks ran at all -> SKIPPED, otherwise CLEAR.
import { screenValue } from "@/lib/screening/embargoMatch";
import { scoreDpsMatch, scoreToMatchStatus } from "@/lib/screening/dpsScreening";
import { getUflpaCountryRules, getUflpaEntityList } from "./forcedLaborRepository";
import type {
  ForcedLaborScreeningInput,
  ForcedLaborScreeningResult,
  ForcedLaborHit,
  ForcedLaborSkip,
  ForcedLaborError,
} from "./types";

export async function runForcedLaborScreening(
  input: ForcedLaborScreeningInput
): Promise<ForcedLaborScreeningResult> {
  const hits: ForcedLaborHit[] = [];
  const skipped: ForcedLaborSkip[] = [];
  const errors: ForcedLaborError[] = [];
  let countryRegionChecksRun = 0;
  let entityListChecksRun = 0;

  // ---- Check 1: country/region rebuttable presumption ----
  let uflpaRules: Awaited<ReturnType<typeof getUflpaCountryRules>> = [];
  try {
    uflpaRules = await getUflpaCountryRules();
  } catch (err) {
    errors.push({ kind: "COUNTRY_REGION", code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (uflpaRules.length === 0 && errors.every((e) => e.kind !== "COUNTRY_REGION")) {
    skipped.push({ kind: "COUNTRY_REGION", reason: "No UFLPA country/region reference data is loaded (EmbargoRule table has no UFLPA regime rows)." });
  } else if (uflpaRules.length > 0) {
    for (const li of input.lineItems) {
      if (!li.countryOfOrigin) {
        skipped.push({ kind: "COUNTRY_REGION", reason: "Line has no country of origin.", lineNumber: li.lineNumber });
        continue;
      }
      countryRegionChecksRun++;
      const matches = screenValue(li.countryOfOrigin, uflpaRules);
      for (const match of matches) {
        hits.push({
          kind: "COUNTRY_REGION",
          lineNumber: li.lineNumber,
          countryOfOrigin: li.countryOfOrigin,
          ruleId: match.countryCode,
          regime: match.regime,
          countryName: match.countryName,
          reason: `Line ${li.lineNumber}: origin "${li.countryOfOrigin}" matches ${match.regime} (${match.countryName}). This is a rebuttable presumption of forced labor under UFLPA -- clear and convincing evidence is required to overcome it before CBP release.`,
        });
      }
    }
  }

  // ---- Check 2: entity-list match ----
  let entityList: Awaited<ReturnType<typeof getUflpaEntityList>> = [];
  try {
    entityList = await getUflpaEntityList();
  } catch (err) {
    errors.push({ kind: "ENTITY_LIST", code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (entityList.length === 0 && errors.every((e) => e.kind !== "ENTITY_LIST")) {
    skipped.push({ kind: "ENTITY_LIST", reason: "No UFLPA Entity List reference data is loaded (ScreeningEntity table has no published UFLPA_ENTITY_LIST rows)." });
  } else if (entityList.length > 0) {
    for (const target of input.entityNames) {
      if (!target.name || !target.name.trim()) {
        skipped.push({ kind: "ENTITY_LIST", reason: "No name available to screen.", role: target.role });
        continue;
      }
      entityListChecksRun++;
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
          kind: "ENTITY_LIST",
          role: target.role,
          targetName: target.name,
          matchedEntityName: bestEntity.name,
          matchScore: bestScore,
          matchStatus,
          entityId: bestEntity.id,
          programCodes: bestEntity.programCodes,
          reason: `${target.role} "${target.name}" ${matchStatus === "BLOCKED" ? "matches" : "closely resembles"} UFLPA Entity List entry "${bestEntity.name}" (score ${bestScore}/100). Supply-chain due-diligence documentation required before CBP release.`,
        });
      }
    }
  }

  const hasHits = hits.length > 0;
  const hasErrors = errors.length > 0;
  const ranAnyCheck = countryRegionChecksRun > 0 || entityListChecksRun > 0;

  let status: ForcedLaborScreeningResult["status"];
  if (hasHits && hasErrors) status = "PARTIAL";
  else if (hasHits) status = "HIT";
  else if (hasErrors) status = "ERROR";
  else if (!ranAnyCheck) status = "SKIPPED";
  else status = "CLEAR";

  return { status, hits, skipped, errors, countryRegionChecksRun, entityListChecksRun };
}
