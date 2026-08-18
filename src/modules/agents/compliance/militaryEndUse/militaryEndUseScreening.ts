// Military End-Use / End-User Screening -- deterministic orchestrator.
//
// Runs both the military-end-use keyword check and the MEU List entity
// check, and combines them into a single result. Status derivation mirrors
// forcedLaborScreening.ts: HIT-only -> HIT, HIT+ERROR -> PARTIAL, ERROR-only
// -> ERROR, no checks ran at all -> SKIPPED, otherwise CLEAR.
import { screenText } from "@/lib/screening/keywordMatch";
import { scoreDpsMatch, scoreToMatchStatus } from "@/lib/screening/fuzzyMatch";
import { getMilitaryEndUseKeywordRules, getMilitaryEndUserList } from "./militaryEndUseRepository";
import type {
  MilitaryEndUseScreeningInput,
  MilitaryEndUseScreeningResult,
  MilitaryEndUseHit,
  MilitaryEndUseSkip,
  MilitaryEndUseError,
} from "./types";

export async function runMilitaryEndUseScreening(
  input: MilitaryEndUseScreeningInput
): Promise<MilitaryEndUseScreeningResult> {
  const hits: MilitaryEndUseHit[] = [];
  const skipped: MilitaryEndUseSkip[] = [];
  const errors: MilitaryEndUseError[] = [];
  let militaryEndUseChecksRun = 0;
  let militaryEndUserChecksRun = 0;

  // ---- Check 1: military end-use keyword match ----
  let keywordRules: Awaited<ReturnType<typeof getMilitaryEndUseKeywordRules>> = [];
  try {
    keywordRules = await getMilitaryEndUseKeywordRules();
  } catch (err) {
    errors.push({ kind: "MILITARY_END_USE", code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (errors.every((e) => e.kind !== "MILITARY_END_USE")) {
    if (keywordRules.length === 0) {
      skipped.push({ kind: "MILITARY_END_USE", reason: "No military-end-use reference data is loaded (ComplianceKeywordRule table has no published MILITARY_END_USE rows)." });
    } else if (!input.endUseStatement || !input.endUseStatement.trim()) {
      skipped.push({ kind: "MILITARY_END_USE", reason: "No end-use statement is available to screen." });
    } else {
      militaryEndUseChecksRun++;
      const matches = screenText(input.endUseStatement, keywordRules);
      for (const rule of matches) {
        hits.push({
          kind: "MILITARY_END_USE",
          matchedPhrase: rule.phrase,
          citation: rule.citation,
          severity: rule.severity,
          reason: `Stated end-use text matches military-end-use phrase "${rule.phrase}".${rule.citation ? ` See ${rule.citation}.` : ""} Review required under EAR Part 744.21 before release.`,
        });
      }
    }
  }

  // ---- Check 2: Military End User (MEU) List entity match ----
  let meuList: Awaited<ReturnType<typeof getMilitaryEndUserList>> = [];
  try {
    meuList = await getMilitaryEndUserList();
  } catch (err) {
    errors.push({ kind: "MILITARY_END_USER", code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (errors.every((e) => e.kind !== "MILITARY_END_USER")) {
    if (meuList.length === 0) {
      skipped.push({ kind: "MILITARY_END_USER", reason: "No Military End User (MEU) List reference data is loaded (ScreeningEntity table has no published MEU_LIST rows)." });
    } else {
      for (const target of input.entityNames) {
        if (!target.name || !target.name.trim()) {
          skipped.push({ kind: "MILITARY_END_USER", reason: "No name available to screen.", role: target.role });
          continue;
        }
        militaryEndUserChecksRun++;
        let bestScore = 0;
        let bestEntity: (typeof meuList)[number] | null = null;
        for (const entity of meuList) {
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
            kind: "MILITARY_END_USER",
            role: target.role,
            targetName: target.name,
            matchedEntityName: bestEntity.name,
            matchScore: bestScore,
            matchStatus,
            entityId: bestEntity.id,
            programCodes: bestEntity.programCodes,
            reason: `${target.role} "${target.name}" ${matchStatus === "BLOCKED" ? "matches" : "closely resembles"} Military End User (MEU) List entry "${bestEntity.name}" (score ${bestScore}/100). Review required under EAR Part 744.21 before release.`,
          });
        }
      }
    }
  }

  const hasHits = hits.length > 0;
  const hasErrors = errors.length > 0;
  const ranAnyCheck = militaryEndUseChecksRun > 0 || militaryEndUserChecksRun > 0;

  let status: MilitaryEndUseScreeningResult["status"];
  if (hasHits && hasErrors) status = "PARTIAL";
  else if (hasHits) status = "HIT";
  else if (hasErrors) status = "ERROR";
  else if (!ranAnyCheck) status = "SKIPPED";
  else status = "CLEAR";

  return { status, hits, skipped, errors, militaryEndUseChecksRun, militaryEndUserChecksRun };
}
