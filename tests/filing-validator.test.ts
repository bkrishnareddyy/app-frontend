import { describe, it, expect } from "vitest";
import {
  runFilingValidation,
  extractPortCode,
  isValidAcePortCode,
  type ValidatorInput,
} from "@/lib/filing/filingValidator";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function validInput(overrides: Partial<ValidatorInput> = {}): ValidatorInput {
  return {
    filingId: "filing_1",
    entryType: "01",
    portOfEntry: "Port of Los Angeles (2704)",
    importerOfRecordId: "ior_1",
    importerCbpNumber: "123456789",
    readinessScore: 90,
    readinessThreshold: 80,
    bondExpirationDate: new Date(Date.now() + 365 * 86_400_000), // 1 year from now
    bondAmount: 500_000,
    estimatedTotalDuties: 100_000,
    lineItems: [{ id: "l1", lineNumber: 1, htsCode: "8481.80.5090", hasApprovedDecision: true }],
    blockingExceptions: [],
    blockingReconciliationIssues: [],
    htsReleaseAgeInDays: 10,
    transportMode: null,
    ...overrides,
  };
}

// ── Port code helpers ──────────────────────────────────────────────────────────

describe("extractPortCode", () => {
  it("extracts a 4-digit code from 'Port of Los Angeles (2704)'", () => {
    expect(extractPortCode("Port of Los Angeles (2704)")).toBe("2704");
  });

  it("returns null when no 4-digit code is present", () => {
    expect(extractPortCode("Los Angeles")).toBeNull();
    expect(extractPortCode(null)).toBeNull();
  });
});

describe("isValidAcePortCode", () => {
  it("recognises known ACE port codes", () => {
    expect(isValidAcePortCode("2704")).toBe(true);
    expect(isValidAcePortCode("4601")).toBe(true);
    expect(isValidAcePortCode("3801")).toBe(true);
  });

  it("rejects unknown port codes", () => {
    expect(isValidAcePortCode("9999")).toBe(false);
    expect(isValidAcePortCode("0000")).toBe(false);
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe("runFilingValidation — valid input", () => {
  it("returns valid=true with no blockers for a fully compliant filing", () => {
    const outcome = runFilingValidation(validInput());
    expect(outcome.valid).toBe(true);
    expect(outcome.blockers).toHaveLength(0);
  });
});

// ── Missing HTS code → blocker ─────────────────────────────────────────────────

describe("runFilingValidation — missing HTS code", () => {
  it("blocks transmission when a line item has no HTS code or approved decision", () => {
    const outcome = runFilingValidation(
      validInput({
        lineItems: [{ id: "l1", lineNumber: 1, htsCode: null, hasApprovedDecision: false }],
      })
    );
    expect(outcome.valid).toBe(false);
    const blocker = outcome.blockers.find((b) => b.rule === "ALL_LINES_HAVE_APPROVED_DECISION");
    expect(blocker).toBeDefined();
    expect(blocker?.blocking).toBe(true);
  });

  it("blocks when HTS code present but no approved decision", () => {
    const outcome = runFilingValidation(
      validInput({
        lineItems: [{ id: "l1", lineNumber: 1, htsCode: "8481.80.5090", hasApprovedDecision: false }],
      })
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "ALL_LINES_HAVE_APPROVED_DECISION")).toBe(true);
  });
});

// ── Blocking exceptions and reconciliation ─────────────────────────────────────

describe("runFilingValidation — blocking issues", () => {
  it("blocks on open blocking exceptions", () => {
    const outcome = runFilingValidation(
      validInput({ blockingExceptions: [{ id: "exc_1" }] })
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "NO_BLOCKING_EXCEPTIONS")).toBe(true);
  });

  it("blocks on unresolved critical reconciliation issues", () => {
    const outcome = runFilingValidation(
      validInput({ blockingReconciliationIssues: [{ id: "rec_1" }] })
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "NO_BLOCKING_RECONCILIATION_ISSUES")).toBe(true);
  });
});

// ── Bond checks ────────────────────────────────────────────────────────────────

describe("runFilingValidation — bond", () => {
  it("blocks on expired bond", () => {
    const outcome = runFilingValidation(
      validInput({ bondExpirationDate: new Date(Date.now() - 86_400_000) }) // yesterday
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "BOND_NOT_EXPIRED")).toBe(true);
  });

  it("warns (does not block) when bond amount is below estimated duties", () => {
    const outcome = runFilingValidation(
      validInput({ bondAmount: 50_000, estimatedTotalDuties: 200_000 })
    );
    const warning = outcome.warnings.find((w) => w.rule === "BOND_SUFFICIENT");
    expect(warning).toBeDefined();
    expect(warning?.blocking).toBe(false);
    // Valid at the blocker level (bond expiry is fine; sufficiency is only a warning)
    expect(outcome.blockers.some((b) => b.rule === "BOND_SUFFICIENT")).toBe(false);
  });
});

// ── Importer CBP number ────────────────────────────────────────────────────────

describe("runFilingValidation — importer CBP number", () => {
  it("blocks when no CBP number is on file", () => {
    const outcome = runFilingValidation(validInput({ importerCbpNumber: null }));
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "IMPORTER_CBP_NUMBER_VALID")).toBe(true);
  });

  it("blocks on a CBP number that is not 9 digits", () => {
    const outcome = runFilingValidation(validInput({ importerCbpNumber: "12345" }));
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "IMPORTER_CBP_NUMBER_VALID")).toBe(true);
  });

  it("accepts a hyphenated 9-digit EIN", () => {
    const outcome = runFilingValidation(validInput({ importerCbpNumber: "12-3456789" }));
    const cbpCheck = outcome.blockers.find((b) => b.rule === "IMPORTER_CBP_NUMBER_VALID");
    expect(cbpCheck).toBeUndefined();
  });
});

// ── Port of entry ──────────────────────────────────────────────────────────────

describe("runFilingValidation — port of entry", () => {
  it("blocks on unknown ACE port code", () => {
    const outcome = runFilingValidation(validInput({ portOfEntry: "Mystery Port (9999)" }));
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "PORT_OF_ENTRY_VALID_ACE_CODE")).toBe(true);
  });

  it("blocks when port of entry string has no 4-digit code", () => {
    const outcome = runFilingValidation(validInput({ portOfEntry: "Los Angeles" }));
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "PORT_OF_ENTRY_VALID_ACE_CODE")).toBe(true);
  });
});

// ── Readiness score ────────────────────────────────────────────────────────────

describe("runFilingValidation — readiness score", () => {
  it("blocks when score is below threshold", () => {
    const outcome = runFilingValidation(validInput({ readinessScore: 60, readinessThreshold: 80 }));
    expect(outcome.valid).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "READINESS_SCORE_THRESHOLD")).toBe(true);
  });

  it("passes when score meets threshold exactly", () => {
    const outcome = runFilingValidation(validInput({ readinessScore: 80, readinessThreshold: 80 }));
    expect(outcome.blockers.some((b) => b.rule === "READINESS_SCORE_THRESHOLD")).toBe(false);
  });
});

// ── HTS freshness warning ─────────────────────────────────────────────────────

describe("runFilingValidation — HTS release freshness", () => {
  it("warns (does not block) when HTS release is over 30 days old", () => {
    const outcome = runFilingValidation(validInput({ htsReleaseAgeInDays: 45 }));
    const warning = outcome.warnings.find((w) => w.rule === "HTS_RELEASE_CURRENT");
    expect(warning).toBeDefined();
    expect(warning?.blocking).toBe(false);
    expect(outcome.blockers.some((b) => b.rule === "HTS_RELEASE_CURRENT")).toBe(false);
  });
});

// ── Transmit gate: all blockers must be resolved ───────────────────────────────

describe("runFilingValidation — transmit gate surface", () => {
  it("reports every unmet requirement at once, not just the first one", () => {
    const outcome = runFilingValidation(
      validInput({
        portOfEntry: null,
        importerCbpNumber: null,
        lineItems: [{ id: "l1", lineNumber: 1, htsCode: null, hasApprovedDecision: false }],
        blockingExceptions: [{ id: "exc_1" }],
        readinessScore: 20,
      })
    );
    expect(outcome.blockers.length).toBeGreaterThanOrEqual(4);
    expect(outcome.valid).toBe(false);
  });
});
