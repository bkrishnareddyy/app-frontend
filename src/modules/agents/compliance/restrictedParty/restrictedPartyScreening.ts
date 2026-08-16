// Restricted / Denied-Party Screening -- deterministic orchestrator.
//
// Runs an independent party-name pass and, only when a contact name is
// present, a separate contact-name pass -- the two never share candidate
// accumulation. Resolves effective threshold/countryMatch/redFlag (request
// override > module default), validates required fields (missing name, or
// countryMatchRequired with no country to check, or an out-of-range
// threshold -> ERROR, never CLEAR), normalizes, generates candidates,
// scores, checks red flags, suppresses via prior Party Master dispositions,
// and aggregates to CLEAR/HIT/REVIEW_REQUIRED/PARTIAL/SKIPPED/ERROR. No
// reference data loaded (and no red-flag rules loaded) must resolve to
// SKIPPED, never CLEAR -- mirrors every sibling compliance module.
import crypto from "crypto";
import { generateCandidates } from "./candidateGeneration";
import { scoreCandidate } from "./scoring";
import { checkRedFlags } from "./redFlagCheck";
import { applySuppressions, type ApprovedDispositionMap } from "./suppression";
import { getApprovedDispositions, getRedFlagRules, getRestrictedPartyReferenceList } from "./restrictedPartyRepository";
import { DEFAULT_NAME_THRESHOLD } from "./types";
import type {
  RestrictedPartyIdentity,
  RestrictedPartyMatchCandidate,
  RestrictedPartyPassOutcome,
  RestrictedPartyPassType,
  RestrictedPartyScreeningInput,
  RestrictedPartyScreeningRunResult,
} from "./types";
import type { ScreeningEntity, ComplianceKeywordRule } from "@prisma/client";

function computeInputHash(passType: RestrictedPartyPassType, name: string, address: string | null, country: string | null, nameThreshold: number, addressThreshold: number | null, countryMatchRequired: boolean): string {
  const normalized = [
    passType,
    name.trim().toLowerCase(),
    (address || "").trim().toLowerCase(),
    (country || "").trim().toLowerCase(),
    nameThreshold,
    addressThreshold ?? "",
    countryMatchRequired,
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

interface PassContext {
  referenceList: ScreeningEntity[] | null;
  referenceError: string | null;
  redFlagRules: ComplianceKeywordRule[] | null;
  redFlagError: string | null;
  approvedDispositions: ApprovedDispositionMap;
}

function runOnePass(
  passType: RestrictedPartyPassType,
  name: string,
  address: string | null,
  city: string | null,
  country: string | null,
  options: { nameThreshold?: number; addressThreshold?: number; countryMatchRequired?: boolean; redFlagCheckEnabled?: boolean },
  ctx: PassContext
): RestrictedPartyPassOutcome {
  const started = Date.now();
  const nameThreshold = options.nameThreshold ?? DEFAULT_NAME_THRESHOLD;
  const addressThreshold = options.addressThreshold ?? null;
  const countryMatchRequired = options.countryMatchRequired ?? false;
  const redFlagCheckEnabled = options.redFlagCheckEnabled ?? true;

  const screeningInputHash = computeInputHash(passType, name, address, country, nameThreshold, addressThreshold, countryMatchRequired);

  const base = {
    passType,
    screenedName: name,
    screenedAddress: address,
    screenedCity: city,
    screenedCountry: country,
    nameThreshold,
    addressThreshold,
    countryMatchRequired,
    redFlagCheckEnabled,
    screeningInputHash,
  };

  if (!name || !name.trim()) {
    return { ...base, status: "ERROR", matches: [], redFlagHits: [], errorCode: "MISSING_NAME", errorMessage: "No name is available to screen.", screeningDurationMs: Date.now() - started };
  }
  if (nameThreshold < 0 || nameThreshold > 100 || (addressThreshold != null && (addressThreshold < 0 || addressThreshold > 100))) {
    return { ...base, status: "ERROR", matches: [], redFlagHits: [], errorCode: "INVALID_THRESHOLD", errorMessage: "nameThreshold/addressThreshold must be between 0 and 100.", screeningDurationMs: Date.now() - started };
  }
  if (countryMatchRequired && (!country || !country.trim())) {
    return { ...base, status: "ERROR", matches: [], redFlagHits: [], errorCode: "MISSING_COUNTRY_FOR_COUNTRY_MATCH", errorMessage: "countryMatchRequired is set but no country was provided to screen against.", screeningDurationMs: Date.now() - started };
  }

  const errors: string[] = [];
  let matches: RestrictedPartyMatchCandidate[] = [];
  let ranDenialOrderCheck = false;

  if (ctx.referenceError) {
    errors.push(ctx.referenceError);
  } else if (ctx.referenceList && ctx.referenceList.length > 0) {
    ranDenialOrderCheck = true;
    const candidates = generateCandidates(name, ctx.referenceList);
    const scored = candidates
      .map((c) => scoreCandidate(c, { targetName: name, targetAddress: address, targetCountry: country, nameThreshold, addressThreshold, countryMatchRequired }))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const suppressed = applySuppressions(scored, ctx.approvedDispositions);
    matches = suppressed
      .sort((a, b) => b.nameScore - a.nameScore)
      .map((m, idx) => ({ ...m, sequence: idx + 1 }));
  }

  let redFlagHits: RestrictedPartyPassOutcome["redFlagHits"] = [];
  let ranRedFlagCheck = false;
  if (redFlagCheckEnabled) {
    if (ctx.redFlagError) {
      errors.push(ctx.redFlagError);
    } else if (ctx.redFlagRules && ctx.redFlagRules.length > 0) {
      ranRedFlagCheck = true;
      redFlagHits = checkRedFlags(name, ctx.redFlagRules);
    }
  }

  const nonSuppressed = matches.filter((m) => !m.suppressedByApprovedParty);
  const hasHit = nonSuppressed.some((m) => m.tier === "HIT");
  const hasSignal = hasHit || nonSuppressed.some((m) => m.tier === "REVIEW_REQUIRED") || redFlagHits.length > 0;
  const hasErrors = errors.length > 0;
  const ranAnyCheck = ranDenialOrderCheck || ranRedFlagCheck;

  let status: RestrictedPartyPassOutcome["status"];
  if (hasSignal && hasErrors) status = "PARTIAL";
  else if (hasHit) status = "HIT";
  else if (hasSignal) status = "REVIEW_REQUIRED";
  else if (hasErrors) status = "ERROR";
  else if (!ranAnyCheck) status = "SKIPPED";
  else status = "CLEAR";

  return {
    ...base,
    status,
    matches,
    redFlagHits,
    errorCode: hasErrors ? "REPOSITORY_ERROR" : null,
    errorMessage: hasErrors ? errors.join("; ") : null,
    screeningDurationMs: Date.now() - started,
  };
}

export async function runRestrictedPartyScreening(input: RestrictedPartyScreeningInput): Promise<RestrictedPartyScreeningRunResult> {
  const correlationId = input.correlationId ?? crypto.randomUUID();

  let referenceList: ScreeningEntity[] | null = null;
  let referenceError: string | null = null;
  try {
    referenceList = await getRestrictedPartyReferenceList();
  } catch (err) {
    referenceError = err instanceof Error ? err.message : String(err);
  }

  let redFlagRules: ComplianceKeywordRule[] | null = null;
  let redFlagError: string | null = null;
  try {
    redFlagRules = await getRedFlagRules();
  } catch (err) {
    redFlagError = err instanceof Error ? err.message : String(err);
  }

  let approvedDispositions: ApprovedDispositionMap = new Map();
  if (input.partyId) {
    try {
      approvedDispositions = await getApprovedDispositions(input.accountId, input.partyId);
    } catch {
      // Suppression is best-effort -- a lookup failure means no suppression is applied, never that matches are hidden.
    }
  }

  const ctx: PassContext = { referenceList, referenceError, redFlagRules, redFlagError, approvedDispositions };
  const options = {
    nameThreshold: input.nameThreshold,
    addressThreshold: input.addressThreshold,
    countryMatchRequired: input.countryMatchRequired,
    redFlagCheckEnabled: input.redFlagCheckEnabled,
  };

  const passes: RestrictedPartyPassOutcome[] = [
    runOnePass("PARTY_NAME", input.identity.name, input.identity.address ?? null, input.identity.city ?? null, input.identity.country ?? null, options, ctx),
  ];

  if (input.identity.contactName && input.identity.contactName.trim()) {
    passes.push(runOnePass("CONTACT_NAME", input.identity.contactName, null, null, input.identity.country ?? null, options, ctx));
  }

  return { correlationId, passes };
}

export type { RestrictedPartyIdentity };
