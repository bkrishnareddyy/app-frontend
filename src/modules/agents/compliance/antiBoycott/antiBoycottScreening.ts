// Anti-Boycott Screening -- deterministic orchestrator.
//
// Runs the country check and the document-language check and combines them
// into a single result. Status derivation mirrors forcedLaborScreening.ts:
// HIT-only -> HIT, HIT+ERROR -> PARTIAL, ERROR-only -> ERROR, no checks ran
// at all -> SKIPPED, otherwise CLEAR.
import { screenText } from "@/lib/screening/keywordMatch";
import { resolveBoycottCountry, getAntiBoycottKeywordRules } from "./antiBoycottRepository";
import type {
  AntiBoycottScreeningInput,
  AntiBoycottScreeningResult,
  AntiBoycottHit,
  AntiBoycottSkip,
  AntiBoycottError,
} from "./types";

export async function runAntiBoycottScreening(input: AntiBoycottScreeningInput): Promise<AntiBoycottScreeningResult> {
  const hits: AntiBoycottHit[] = [];
  const skipped: AntiBoycottSkip[] = [];
  const errors: AntiBoycottError[] = [];
  let countryChecksRun = 0;
  let documentChecksRun = 0;

  // ---- Check 1: destination country boycott flag ----
  if (!input.destinationCountry || !input.destinationCountry.trim()) {
    skipped.push({ kind: "COUNTRY", reason: "No destination country is available to screen." });
  } else {
    try {
      const country = await resolveBoycottCountry(input.destinationCountry);
      if (!country) {
        errors.push({ kind: "COUNTRY", code: "UNRESOLVABLE_COUNTRY", message: `Destination country "${input.destinationCountry}" could not be resolved against the countries reference table.` });
      } else {
        countryChecksRun++;
        if (country.cyIndBoycotted === "Y") {
          hits.push({
            kind: "COUNTRY",
            country: input.destinationCountry,
            reason: `Destination country "${input.destinationCountry}" is flagged as a boycotting country (cy_ind_boycotted = Y). Anti-boycott reporting/compliance review required under EAR Part 760.`,
          });
        }
      }
    } catch (err) {
      errors.push({ kind: "COUNTRY", code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- Check 2: document/narrative boycott-request language ----
  let rules: Awaited<ReturnType<typeof getAntiBoycottKeywordRules>> = [];
  try {
    rules = await getAntiBoycottKeywordRules();
  } catch (err) {
    errors.push({ kind: "DOCUMENT_LANGUAGE", code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (errors.every((e) => e.kind !== "DOCUMENT_LANGUAGE")) {
    if (rules.length === 0) {
      skipped.push({ kind: "DOCUMENT_LANGUAGE", reason: "No boycott-request language reference data is loaded (ComplianceKeywordRule table has no published ANTI_BOYCOTT_REQUEST rows)." });
    } else if (!input.documentNarrativeText || !input.documentNarrativeText.trim()) {
      skipped.push({ kind: "DOCUMENT_LANGUAGE", reason: "No transaction document/narrative text is available to screen." });
    } else {
      documentChecksRun++;
      const matches = screenText(input.documentNarrativeText, rules);
      for (const rule of matches) {
        hits.push({
          kind: "DOCUMENT_LANGUAGE",
          matchedPhrase: rule.phrase,
          citation: rule.citation,
          severity: rule.severity,
          reason: `Transaction document text matches boycott-request phrase "${rule.phrase}".${rule.citation ? ` See ${rule.citation}.` : ""} Reportable request under EAR Part 760 -- manual review required.`,
        });
      }
    }
  }

  const hasHits = hits.length > 0;
  const hasErrors = errors.length > 0;
  const ranAnyCheck = countryChecksRun > 0 || documentChecksRun > 0;

  let status: AntiBoycottScreeningResult["status"];
  if (hasHits && hasErrors) status = "PARTIAL";
  else if (hasHits) status = "HIT";
  else if (hasErrors) status = "ERROR";
  else if (!ranAnyCheck) status = "SKIPPED";
  else status = "CLEAR";

  return { status, hits, skipped, errors, countryChecksRun, documentChecksRun };
}
