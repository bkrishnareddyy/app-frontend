// Country Embargo Screening -- deterministic orchestrator.
//
// Runs transaction / party / line-destination / line-origin screening
// (CountryEmbargoScreening_Prompt.md sections 7-17), dispatches each check
// through doEmbargoCheck's matcher precedence, applies duplicate
// suppression to hits (not to the underlying checks -- every applicable
// check is always run and audited per section 36's explicit "PASS and FAIL"
// requirement for all four check kinds), and persists the SERVICE_USAGE /
// SERVICE_USAGE_LINES-equivalent audit trail.
//
// This is a deterministic module -- it must never be replaced by or routed
// through an LLM. Gemini synthesis in complianceAuditAgent.ts may only
// summarize the CountryEmbargoScreeningResult this function returns.
import { doEmbargoCheck } from "./doEmbargoCheck";
import { parseClassification } from "./classificationParser";
import { buildEmbargoAuditContext, createEmbargoUsageHeader, createEmbargoUsageLines } from "./embargoAudit";
import type {
  CountryEmbargoScreeningInput,
  CountryEmbargoScreeningResult,
  CountryEmbargoHit,
  EmbargoCheckContext,
  EmbargoCheckResult,
  EmbargoScreeningSkip,
  ScreeningLevel,
} from "./types";

function hitToFinding(check: EmbargoCheckResult): CountryEmbargoHit {
  const ctx = check.context;
  return {
    accountId: ctx.accountId,
    shipmentId: ctx.shipmentId,
    transactionId: ctx.transactionId,
    partyId: ctx.partyId,
    lineItemId: ctx.lineItemId,
    userDefined: ctx.userDefined,
    screeningLevel: check.screeningLevel,
    type: check.type,
    complianceCountry: check.complianceCountry,
    country: check.screenedCountry,
    embargo: "Y",
    eccn: check.eccn,
    militaryEndUse: check.militaryEndUse,
    matcher: check.matcher,
    ruleId: check.ruleId,
    reason: check.reason ?? "Country embargo match.",
    evidence: check.evidence,
  };
}

function buildContext(
  input: CountryEmbargoScreeningInput,
  level: ScreeningLevel,
  type: "D" | "O",
  targetCountry: string,
  extra: Partial<EmbargoCheckContext> = {}
): EmbargoCheckContext {
  return {
    accountId: input.accountId,
    shipmentId: input.shipmentId,
    transactionId: input.transactionId,
    screeningLevel: level,
    complianceCountry: input.shipFromCountry,
    targetCountry,
    type,
    screeningDate: input.screeningDate,
    accountConfig: input.accountConfig,
    ...extra,
  };
}

export async function runCountryEmbargoScreening(
  input: CountryEmbargoScreeningInput
): Promise<CountryEmbargoScreeningResult> {
  if (!input.accountConfig.embargoScreeningEnabled || input.embargoScreening === false) {
    return {
      status: "SKIPPED",
      hits: [],
      checks: [],
      skippedChecks: [{ reason: "EMBARGO_SCREENING_DISABLED" }],
      errors: [],
    };
  }

  const checks: EmbargoCheckResult[] = [];
  const skippedChecks: EmbargoScreeningSkip[] = [];
  const hits: CountryEmbargoHit[] = [];

  // Duplicate suppression state (section 27): a hit is suppressed only when
  // it is the *same logical party* re-screened at a lower precedence level,
  // never merely "same country, different party".
  const shipToCountrySuppressed = new Set<string>();
  const shipToPartyIdsSuppressed = new Set<string>();

  const parties = input.parties ?? [];
  const shipToParty = parties.find((p) => p.isShipTo);

  // --- 1. Transaction-level destination screening ---
  if (input.shipToCountry) {
    const ctx = buildContext(input, "TRANSACTION", "D", input.shipToCountry);
    const result = await doEmbargoCheck(ctx);
    checks.push(result);
    if (result.result === "HIT") {
      hits.push(hitToFinding(result));
      shipToCountrySuppressed.add(input.shipToCountry.trim().toLowerCase());
      if (shipToParty) shipToPartyIdsSuppressed.add(shipToParty.partyId);
    }
  } else {
    skippedChecks.push({ reason: "MISSING_SHIP_TO_COUNTRY", screeningLevel: "TRANSACTION" });
  }

  // --- 2. Party-level destination screening ---
  for (const party of parties) {
    if (!party.country) {
      skippedChecks.push({ reason: "MISSING_PARTY_COUNTRY", screeningLevel: "PARTY", partyId: party.partyId });
      continue;
    }
    const ctx = buildContext(input, "PARTY", "D", party.country, {
      partyId: party.partyId,
      userDefined: party.userDefined ?? undefined,
      militaryEndUse: party.militaryEndUse,
    });
    const result = await doEmbargoCheck(ctx);
    checks.push(result);
    if (result.result === "HIT") {
      const isDuplicateOfTransactionHit =
        party.isShipTo && shipToCountrySuppressed.has(party.country.trim().toLowerCase());
      if (!isDuplicateOfTransactionHit) {
        hits.push(hitToFinding(result));
      }
      shipToPartyIdsSuppressed.add(party.partyId);
    }
  }

  // --- 3. Line destination + origin screening ---
  for (const line of input.lineItems ?? []) {
    const parsed = parseClassification(line.classification);
    const eccn = line.eccn ?? parsed.eccn;

    if (line.destinationParty?.country) {
      const militaryEndUse = line.destinationParty.militaryEndUse ?? shipToParty?.militaryEndUse;
      const ctx = buildContext(input, "LINE", "D", line.destinationParty.country, {
        lineItemId: line.lineItemId,
        partyId: line.destinationParty.partyId,
        eccn: eccn ?? undefined,
        militaryEndUse,
      });
      const result = await doEmbargoCheck(ctx);
      checks.push(result);
      if (result.result === "HIT") {
        const isDuplicateOfPartyHit = shipToPartyIdsSuppressed.has(line.destinationParty.partyId);
        if (!isDuplicateOfPartyHit) {
          hits.push(hitToFinding(result));
        }
      }
    } else {
      skippedChecks.push({ reason: "MISSING_LINE_DESTINATION_PARTY", screeningLevel: "LINE", lineItemId: line.lineItemId });
    }

    if (line.countryOfOrigin) {
      const ctx = buildContext(input, "LINE", "O", line.countryOfOrigin, {
        lineItemId: line.lineItemId,
        eccn: eccn ?? undefined,
        militaryEndUse: shipToParty?.militaryEndUse,
      });
      const result = await doEmbargoCheck(ctx);
      checks.push(result);
      // Destination and origin findings remain logically distinct -- never suppressed against each other.
      if (result.result === "HIT") {
        hits.push(hitToFinding(result));
      }
    } else {
      skippedChecks.push({ reason: "MISSING_COUNTRY_OF_ORIGIN", screeningLevel: "LINE", lineItemId: line.lineItemId });
    }
  }

  const errors = checks
    .filter((c) => c.result === "ERROR")
    .map((c) => ({ code: c.reason ?? "EMBARGO_CHECK_ERROR", message: `${c.screeningLevel}/${c.type} check for ${c.screenedCountry} could not be completed.` }));

  let status: CountryEmbargoScreeningResult["status"];
  if (errors.length > 0 && hits.length === 0) status = "ERROR";
  else if (hits.length > 0 && errors.length > 0) status = "PARTIAL";
  else if (hits.length > 0) status = "HIT";
  else status = "CLEAR";

  // --- Audit persistence ---
  const auditContext = buildEmbargoAuditContext(input.accountConfig);
  let usageId: string | undefined;
  let headerCreated = false;
  let detailedLinesCreated = 0;

  if (auditContext.audited) {
    const created = await createEmbargoUsageHeader({
      accountId: input.accountId,
      shipmentId: input.shipmentId,
      transactionId: input.transactionId,
      correlationId: input.correlationId,
    });
    if (created) {
      usageId = created;
      headerCreated = true;
      if (auditContext.writeDetailedLines) {
        detailedLinesCreated = await createEmbargoUsageLines(created, input.accountId, checks);
      }
    }
  }

  return {
    status,
    hits,
    checks,
    skippedChecks,
    errors,
    audit: { usageId, headerCreated, detailedLinesCreated },
  };
}
