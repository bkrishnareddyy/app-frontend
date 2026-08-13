/**
 * Pre-filing validation rules for CBP Form 7501.
 *
 * Pure and database-free: the caller fetches all required data and passes it in,
 * so this module can be asserted without a database connection.
 *
 * Each ValidationResult carries `blocking: true` for hard gates (transmit returns
 * 422 if any blocking check fails) and `blocking: false` for warnings (shown in
 * the UI but do not prevent transmission).
 */

import ACE_PORTS_RAW from "../../../prisma/seed-data/ace-ports.json";

const ACE_PORT_CODES = new Set<string>(
  (ACE_PORTS_RAW as Array<{ code: string; name: string }>).map((p) => p.code)
);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  field: string;
  rule: string;
  passed: boolean;
  message: string;
  /** True = transmit is gated on this check; false = surfaced as a warning only. */
  blocking: boolean;
}

export interface ValidationOutcome {
  valid: boolean;
  blockers: ValidationResult[];
  warnings: ValidationResult[];
}

export interface ValidatorLineItem {
  id: string;
  lineNumber: number;
  htsCode: string | null;
  /** True when an APPROVED ClassificationDecision exists for this line's product. */
  hasApprovedDecision: boolean;
}

export interface ValidatorInput {
  filingId: string;
  entryType: string | null;
  portOfEntry: string | null;
  importerOfRecordId: string | null;
  importerCbpNumber: string | null;
  /** Shipment.readinessScore */
  readinessScore: number | null;
  /** Configurable threshold (default 80). From AgentPolicyConfig or a hard default. */
  readinessThreshold: number;
  // Bond
  bondExpirationDate: Date | null;
  bondAmount: number | null;
  /** Estimated total duties (from CustomsFiling.totalDuties) for bond sufficiency check. */
  estimatedTotalDuties: number | null;
  // Line items
  lineItems: ValidatorLineItem[];
  // Unresolved blocking issues
  blockingExceptions: Array<{ id: string }>;
  blockingReconciliationIssues: Array<{ id: string }>;
  // HTS release freshness in days (null = could not be determined)
  htsReleaseAgeInDays: number | null;
  // Transport mode for entry-type compatibility check
  transportMode: string | null;
  validEntryTypesForMode?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pass(field: string, rule: string, message: string, blocking: boolean): ValidationResult {
  return { field, rule, passed: true, message, blocking };
}

function fail(field: string, rule: string, message: string, blocking: boolean): ValidationResult {
  return { field, rule, passed: false, message, blocking };
}

/** Extract a 4-digit ACE port code from a string like "Port of Los Angeles (2704)". */
export function extractPortCode(portOfEntry: string | null): string | null {
  if (!portOfEntry) return null;
  const match = portOfEntry.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

export function isValidAcePortCode(code: string): boolean {
  return ACE_PORT_CODES.has(code);
}

// ── Individual checks ──────────────────────────────────────────────────────────

function check7501BlocksPopulated(input: ValidatorInput): ValidationResult {
  const missing: string[] = [];
  if (!input.entryType) missing.push("Entry Type (Block 2)");
  if (!input.importerOfRecordId) missing.push("Importer of Record (Block 23)");
  if (!input.portOfEntry) missing.push("Port of Entry (Block 45)");
  if (input.lineItems.length === 0) missing.push("Line Items (Block 28–35)");

  if (missing.length > 0) {
    return fail(
      "form7501",
      "REQUIRED_7501_BLOCKS_POPULATED",
      `Required 7501 blocks missing: ${missing.join(", ")}.`,
      true
    );
  }
  return pass("form7501", "REQUIRED_7501_BLOCKS_POPULATED", "All required 7501 blocks are populated.", true);
}

function checkAllLinesClassified(input: ValidatorInput): ValidationResult {
  const noHts = input.lineItems.filter((li) => !li.htsCode && !li.hasApprovedDecision);
  if (noHts.length > 0) {
    return fail(
      "lineItems",
      "ALL_LINES_HAVE_APPROVED_DECISION",
      `${noHts.length} line item(s) have no HTS code or approved classification decision: line(s) ${noHts.map((li) => li.lineNumber).join(", ")}.`,
      true
    );
  }
  const unapproved = input.lineItems.filter((li) => !!li.htsCode && !li.hasApprovedDecision);
  if (unapproved.length > 0) {
    return fail(
      "lineItems",
      "ALL_LINES_HAVE_APPROVED_DECISION",
      `${unapproved.length} line item(s) have an HTS code but no approved classification decision: line(s) ${unapproved.map((li) => li.lineNumber).join(", ")}.`,
      true
    );
  }
  return pass(
    "lineItems",
    "ALL_LINES_HAVE_APPROVED_DECISION",
    `All ${input.lineItems.length} line item(s) have an approved classification decision.`,
    true
  );
}

function checkBlockingReconciliationIssues(input: ValidatorInput): ValidationResult {
  if (input.blockingReconciliationIssues.length > 0) {
    return fail(
      "reconciliationIssues",
      "NO_BLOCKING_RECONCILIATION_ISSUES",
      `${input.blockingReconciliationIssues.length} reconciliation issue(s) with blocksFiling=true remain unresolved.`,
      true
    );
  }
  return pass("reconciliationIssues", "NO_BLOCKING_RECONCILIATION_ISSUES", "No blocking reconciliation issues.", true);
}

function checkBlockingExceptions(input: ValidatorInput): ValidationResult {
  if (input.blockingExceptions.length > 0) {
    return fail(
      "exceptions",
      "NO_BLOCKING_EXCEPTIONS",
      `${input.blockingExceptions.length} blocking exception(s) are unresolved.`,
      true
    );
  }
  return pass("exceptions", "NO_BLOCKING_EXCEPTIONS", "No blocking exceptions.", true);
}

function checkBond(input: ValidatorInput): ValidationResult[] {
  if (!input.bondExpirationDate) {
    return [
      pass("bond", "BOND_NOT_EXPIRED", "Bond expiration date not on file — cannot verify.", false),
      pass("bond", "BOND_SUFFICIENT", "Bond sufficiency cannot be verified: expiration date not on file.", false),
    ];
  }

  const results: ValidationResult[] = [];
  const now = new Date();

  if (input.bondExpirationDate < now) {
    results.push(
      fail(
        "bond",
        "BOND_NOT_EXPIRED",
        `Bond expired on ${input.bondExpirationDate.toISOString().slice(0, 10)}.`,
        true
      )
    );
  } else {
    results.push(
      pass("bond", "BOND_NOT_EXPIRED", `Bond valid until ${input.bondExpirationDate.toISOString().slice(0, 10)}.`, true)
    );
  }

  if (input.bondAmount !== null && input.estimatedTotalDuties !== null) {
    if (input.bondAmount < input.estimatedTotalDuties) {
      results.push(
        fail(
          "bond",
          "BOND_SUFFICIENT",
          `Bond amount ($${input.bondAmount.toFixed(2)}) may be insufficient to cover estimated duties ($${input.estimatedTotalDuties.toFixed(2)}).`,
          false
        )
      );
    } else {
      results.push(
        pass(
          "bond",
          "BOND_SUFFICIENT",
          `Bond amount ($${input.bondAmount.toFixed(2)}) covers estimated duties ($${input.estimatedTotalDuties.toFixed(2)}).`,
          false
        )
      );
    }
  } else {
    results.push(
      pass("bond", "BOND_SUFFICIENT", "Bond sufficiency cannot be verified: bond amount or duty estimate not available.", false)
    );
  }

  return results;
}

function checkImporterCbpNumber(input: ValidatorInput): ValidationResult {
  if (!input.importerOfRecordId) {
    return fail("importerOfRecord", "IMPORTER_CBP_NUMBER_VALID", "No importer of record is linked to this filing.", true);
  }
  if (!input.importerCbpNumber) {
    return fail(
      "importerOfRecord",
      "IMPORTER_CBP_NUMBER_VALID",
      "Importer of Record does not have a CBP importer number on file.",
      true
    );
  }
  // CBP importer number is 9 digits (EIN format) after stripping hyphens/spaces
  const digits = input.importerCbpNumber.replace(/[\D]/g, "");
  if (digits.length !== 9) {
    return fail(
      "importerOfRecord",
      "IMPORTER_CBP_NUMBER_VALID",
      `CBP importer number "${input.importerCbpNumber}" does not appear to be a valid 9-digit format.`,
      true
    );
  }
  return pass(
    "importerOfRecord",
    "IMPORTER_CBP_NUMBER_VALID",
    `CBP importer number "${input.importerCbpNumber}" is present.`,
    true
  );
}

function checkPortOfEntry(input: ValidatorInput): ValidationResult {
  if (!input.portOfEntry) {
    return fail("portOfEntry", "PORT_OF_ENTRY_VALID_ACE_CODE", "Port of entry is not set.", true);
  }
  const code = extractPortCode(input.portOfEntry);
  if (!code) {
    return fail(
      "portOfEntry",
      "PORT_OF_ENTRY_VALID_ACE_CODE",
      `Port of entry "${input.portOfEntry}" does not contain a recognisable 4-digit ACE port code.`,
      true
    );
  }
  if (!isValidAcePortCode(code)) {
    return fail(
      "portOfEntry",
      "PORT_OF_ENTRY_VALID_ACE_CODE",
      `Port code "${code}" (from "${input.portOfEntry}") is not in the known ACE port code list.`,
      true
    );
  }
  return pass("portOfEntry", "PORT_OF_ENTRY_VALID_ACE_CODE", `Port of entry code "${code}" is a valid ACE port.`, true);
}

function checkEntryTypeForMode(input: ValidatorInput): ValidationResult {
  if (!input.transportMode || !input.validEntryTypesForMode || input.validEntryTypesForMode.length === 0) {
    return pass(
      "entryType",
      "ENTRY_TYPE_VALID_FOR_MODE",
      "Entry type vs. transport mode compatibility check skipped: no mode-specific rule configured.",
      false
    );
  }
  if (input.entryType && !input.validEntryTypesForMode.includes(input.entryType)) {
    return fail(
      "entryType",
      "ENTRY_TYPE_VALID_FOR_MODE",
      `Entry type "${input.entryType}" may not be valid for transport mode "${input.transportMode}".`,
      false
    );
  }
  return pass("entryType", "ENTRY_TYPE_VALID_FOR_MODE", "Entry type is appropriate for the shipment mode.", false);
}

function checkHtsReleaseFreshness(input: ValidatorInput): ValidationResult {
  if (input.htsReleaseAgeInDays === null) {
    return pass("htsRelease", "HTS_RELEASE_CURRENT", "HTS release age could not be determined.", false);
  }
  if (input.htsReleaseAgeInDays > 30) {
    return fail(
      "htsRelease",
      "HTS_RELEASE_CURRENT",
      `HTS release used is ${input.htsReleaseAgeInDays} day(s) old (> 30 days). Duty rates may not reflect current tariff schedule.`,
      false
    );
  }
  return pass("htsRelease", "HTS_RELEASE_CURRENT", `HTS release is ${input.htsReleaseAgeInDays} day(s) old — within the 30-day freshness window.`, false);
}

function checkReadinessScore(input: ValidatorInput): ValidationResult {
  const score = input.readinessScore ?? 0;
  const threshold = input.readinessThreshold;
  if (score < threshold) {
    return fail(
      "readinessScore",
      "READINESS_SCORE_THRESHOLD",
      `Shipment readiness score is ${score}, below the required threshold of ${threshold}.`,
      true
    );
  }
  return pass(
    "readinessScore",
    "READINESS_SCORE_THRESHOLD",
    `Shipment readiness score is ${score} (threshold: ${threshold}).`,
    true
  );
}

// ── Main entry point ───────────────────────────────────────────────────────────

export function runFilingValidation(input: ValidatorInput): ValidationOutcome {
  const results: ValidationResult[] = [
    check7501BlocksPopulated(input),
    checkAllLinesClassified(input),
    checkBlockingReconciliationIssues(input),
    checkBlockingExceptions(input),
    ...checkBond(input),
    checkImporterCbpNumber(input),
    checkPortOfEntry(input),
    checkEntryTypeForMode(input),
    checkHtsReleaseFreshness(input),
    checkReadinessScore(input),
  ];

  const blockers = results.filter((r) => !r.passed && r.blocking);
  const warnings = results.filter((r) => !r.passed && !r.blocking);
  return { valid: blockers.length === 0, blockers, warnings };
}
