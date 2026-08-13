import { describe, it, expect } from "vitest";
import {
  runAuditChecks,
  AUDIT_CHECKS,
  type FilingSnapshotInput,
  type AuditRunResult,
} from "@/lib/compliance/auditChecklist";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 365 * 86_400_000);
const PAST = new Date(Date.now() - 30 * 86_400_000);

function baseSnapshot(overrides: Partial<FilingSnapshotInput> = {}): FilingSnapshotInput {
  return {
    filingId: "filing_1",
    snapshotId: "snap_1",
    snapshotHtsCode: "8481.80.5090",
    currentHtsCode: "8481.80.5090",
    declaredValue: 10_000,
    finalInvoiceValue: 10_000,
    coveredByAdCvd: false,
    bondExpirationDate: FUTURE,
    liquidationDate: PAST,
    overFormalEntryThreshold: true,
    hasBrokerApproval: true,
    ...overrides,
  };
}

function resultFor(results: AuditRunResult[], checkId: string): AuditRunResult {
  const r = results.find((x) => x.checkId === checkId);
  if (!r) throw new Error(`No result found for checkId "${checkId}"`);
  return r;
}

// ── Checklist structure ────────────────────────────────────────────────────────

describe("AUDIT_CHECKS", () => {
  it("exports exactly 5 checks", () => {
    expect(AUDIT_CHECKS).toHaveLength(5);
  });

  it("has unique check IDs", () => {
    const ids = AUDIT_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runAuditChecks returns one result per check", () => {
    const results = runAuditChecks(baseSnapshot());
    expect(results).toHaveLength(AUDIT_CHECKS.length);
  });
});

// ── HTS_CHANGE_AFTER_FILING ───────────────────────────────────────────────────

describe("HTS_CHANGE_AFTER_FILING", () => {
  const ID = "HTS_CHANGE_AFTER_FILING";

  it("passes when snapshot and current HTS codes match", () => {
    const r = resultFor(runAuditChecks(baseSnapshot()), ID);
    expect(r.result.status).toBe("PASS");
  });

  it("fails when HTS code changed after filing", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ currentHtsCode: "6204.62.4010" })),
      ID
    );
    expect(r.result.status).toBe("FAIL");
    expect(r.result.evidence).toContain("8481.80.5090");
    expect(r.result.evidence).toContain("6204.62.4010");
  });

  it("is NOT_EVALUATED when snapshot HTS code is missing", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ snapshotHtsCode: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("is NOT_EVALUATED when current HTS code is missing", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ currentHtsCode: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("carries HIGH severity", () => {
    const r = resultFor(runAuditChecks(baseSnapshot()), ID);
    expect(r.severity).toBe("HIGH");
  });
});

// ── VALUE_DISCREPANCY ─────────────────────────────────────────────────────────

describe("VALUE_DISCREPANCY", () => {
  const ID = "VALUE_DISCREPANCY";

  it("passes when declared value equals final invoice value", () => {
    const r = resultFor(runAuditChecks(baseSnapshot()), ID);
    expect(r.result.status).toBe("PASS");
  });

  it("passes when discrepancy is exactly at the 5% boundary", () => {
    // 10000 declared, 10526 invoice → diff 526 / 10526 = 4.998…% < 5%
    const r = resultFor(
      runAuditChecks(baseSnapshot({ declaredValue: 10_000, finalInvoiceValue: 10_526 })),
      ID
    );
    expect(r.result.status).toBe("PASS");
  });

  it("fails when discrepancy exceeds 5%", () => {
    // 10000 declared, 11000 invoice → 9.09% > 5%
    const r = resultFor(
      runAuditChecks(baseSnapshot({ declaredValue: 10_000, finalInvoiceValue: 11_000 })),
      ID
    );
    expect(r.result.status).toBe("FAIL");
    expect(r.result.evidence).toContain("%");
  });

  it("is NOT_EVALUATED when declared value is null", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ declaredValue: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("is NOT_EVALUATED when final invoice value is null", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ finalInvoiceValue: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("is NOT_EVALUATED when final invoice value is zero", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ finalInvoiceValue: 0 })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });
});

// ── ADCVD_COVERAGE ────────────────────────────────────────────────────────────

describe("ADCVD_COVERAGE", () => {
  const ID = "ADCVD_COVERAGE";

  it("passes when the HTS code is not covered by any AD/CVD order", () => {
    const r = resultFor(runAuditChecks(baseSnapshot({ coveredByAdCvd: false })), ID);
    expect(r.result.status).toBe("PASS");
  });

  it("fails when an active AD/CVD order covers the HTS code", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ coveredByAdCvd: true })),
      ID
    );
    expect(r.result.status).toBe("FAIL");
  });

  it("is NOT_EVALUATED when AD/CVD coverage is unknown (null)", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ coveredByAdCvd: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("carries CRITICAL severity", () => {
    const r = resultFor(runAuditChecks(baseSnapshot()), ID);
    expect(r.severity).toBe("CRITICAL");
  });
});

// ── BOND_EXPIRY_BEFORE_LIQUIDATION ────────────────────────────────────────────

describe("BOND_EXPIRY_BEFORE_LIQUIDATION", () => {
  const ID = "BOND_EXPIRY_BEFORE_LIQUIDATION";

  it("passes when bond is valid through the liquidation date", () => {
    // bondExpirationDate = FUTURE, liquidationDate = PAST → bond expires after liquidation
    const r = resultFor(runAuditChecks(baseSnapshot()), ID);
    expect(r.result.status).toBe("PASS");
  });

  it("fails when bond expired before the liquidation date", () => {
    const expiredBond = new Date(Date.now() - 60 * 86_400_000); // 60 days ago
    const futureLiquidation = new Date(Date.now() + 30 * 86_400_000); // 30 days from now
    const r = resultFor(
      runAuditChecks(
        baseSnapshot({ bondExpirationDate: expiredBond, liquidationDate: futureLiquidation })
      ),
      ID
    );
    expect(r.result.status).toBe("FAIL");
    expect(r.result.evidence).toContain(expiredBond.toISOString().slice(0, 10));
  });

  it("is NOT_EVALUATED when bond expiration date is missing", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ bondExpirationDate: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("is NOT_EVALUATED when liquidation date is missing", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ liquidationDate: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });
});

// ── BROKER_APPROVAL_FOR_FORMAL_ENTRY ──────────────────────────────────────────

describe("BROKER_APPROVAL_FOR_FORMAL_ENTRY", () => {
  const ID = "BROKER_APPROVAL_FOR_FORMAL_ENTRY";

  it("passes for formal entry with broker approval", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ overFormalEntryThreshold: true, hasBrokerApproval: true })),
      ID
    );
    expect(r.result.status).toBe("PASS");
  });

  it("fails for formal entry without broker approval", () => {
    const r = resultFor(
      runAuditChecks(
        baseSnapshot({ overFormalEntryThreshold: true, hasBrokerApproval: false })
      ),
      ID
    );
    expect(r.result.status).toBe("FAIL");
    expect(r.result.evidence).toContain("$2,500");
  });

  it("passes for informal entry (below threshold) regardless of broker approval", () => {
    const r = resultFor(
      runAuditChecks(
        baseSnapshot({ overFormalEntryThreshold: false, hasBrokerApproval: false })
      ),
      ID
    );
    expect(r.result.status).toBe("PASS");
  });

  it("is NOT_EVALUATED when threshold status is unknown", () => {
    const r = resultFor(
      runAuditChecks(baseSnapshot({ overFormalEntryThreshold: null })),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("is NOT_EVALUATED when formal entry but broker approval status unknown", () => {
    const r = resultFor(
      runAuditChecks(
        baseSnapshot({ overFormalEntryThreshold: true, hasBrokerApproval: null })
      ),
      ID
    );
    expect(r.result.status).toBe("NOT_EVALUATED");
  });

  it("carries MEDIUM severity", () => {
    const r = resultFor(runAuditChecks(baseSnapshot()), ID);
    expect(r.severity).toBe("MEDIUM");
  });
});

// ── Idempotency (pure function — same input, same output) ─────────────────────

describe("runAuditChecks idempotency", () => {
  it("produces identical results on repeated calls with the same input", () => {
    const snapshot = baseSnapshot({ coveredByAdCvd: true, currentHtsCode: "6204.62.4010" });
    const first = runAuditChecks(snapshot);
    const second = runAuditChecks(snapshot);
    expect(second).toEqual(first);
  });

  it("does not mutate the input snapshot between calls", () => {
    const snapshot = baseSnapshot();
    const before = JSON.stringify(snapshot);
    runAuditChecks(snapshot);
    runAuditChecks(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

// ── All-pass baseline ─────────────────────────────────────────────────────────

describe("runAuditChecks — clean filing passes all checks", () => {
  it("returns all PASS for a well-formed filing with no issues", () => {
    const results = runAuditChecks(baseSnapshot());
    const nonPass = results.filter((r) => r.result.status !== "PASS");
    expect(nonPass).toHaveLength(0);
  });
});

// ── All-fail scenario ─────────────────────────────────────────────────────────

describe("runAuditChecks — filing with all issues", () => {
  it("returns FAIL for every evaluable check when all issues are present", () => {
    const expiredBond = new Date(Date.now() - 60 * 86_400_000);
    const futureLiquidation = new Date(Date.now() + 30 * 86_400_000);
    const results = runAuditChecks(
      baseSnapshot({
        currentHtsCode: "6204.62.4010",         // HTS changed
        declaredValue: 10_000,
        finalInvoiceValue: 15_000,               // 33% discrepancy → FAIL
        coveredByAdCvd: true,                    // AD/CVD → FAIL
        bondExpirationDate: expiredBond,
        liquidationDate: futureLiquidation,       // bond expired before liquidation → FAIL
        overFormalEntryThreshold: true,
        hasBrokerApproval: false,                // no broker → FAIL
      })
    );

    const fails = results.filter((r) => r.result.status === "FAIL");
    expect(fails).toHaveLength(5);
  });
});
