/**
 * Continuous compliance audit checklist.
 *
 * Each AuditCheck is pure and database-free: the caller provides a
 * FilingSnapshotInput pre-populated from the database. This makes every
 * check assertable without a test database.
 *
 * The checklist is typed so a new check is a new entry in AUDIT_CHECKS,
 * not a string appended to a switch/if-chain. No hardcoded risk scores.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type CheckSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type CheckResultStatus = "PASS" | "FAIL" | "NOT_EVALUATED";

export interface CheckResult {
  status: CheckResultStatus;
  evidence: string;
}

/**
 * All values the checklist needs from a single filing's snapshot plus
 * current-state facts that may have changed since the snapshot was taken.
 */
export interface FilingSnapshotInput {
  filingId: string;
  snapshotId?: string | null;
  /** HTS code recorded in FilingSnapshot at transmission. */
  snapshotHtsCode?: string | null;
  /** Current HTS code from ProductClassification (may differ from snapshot). */
  currentHtsCode?: string | null;
  /** Declared customs value at filing (from CustomsFiling.totalValue). */
  declaredValue?: number | null;
  /** Final invoice value after reconciliation, if available. */
  finalInvoiceValue?: number | null;
  /** Whether any active AD/CVD order covers the HTS code used at filing. */
  coveredByAdCvd?: boolean | null;
  bondExpirationDate?: Date | null;
  /** Expected or actual liquidation date. */
  liquidationDate?: Date | null;
  /** Entry value > $2,500 (formal entry threshold requiring licensed broker). */
  overFormalEntryThreshold?: boolean | null;
  /** True when a licensed broker approved the classification before transmission. */
  hasBrokerApproval?: boolean | null;
}

export interface AuditCheck {
  id: string;
  name: string;
  description: string;
  severity: CheckSeverity;
  evaluate: (snapshot: FilingSnapshotInput) => CheckResult;
}

export interface AuditRunResult {
  checkId: string;
  checkName: string;
  severity: CheckSeverity;
  result: CheckResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function notEvaluated(reason: string): CheckResult {
  return { status: "NOT_EVALUATED", evidence: reason };
}

function passResult(evidence: string): CheckResult {
  return { status: "PASS", evidence };
}

function failResult(evidence: string): CheckResult {
  return { status: "FAIL", evidence };
}

// ── Individual checks ──────────────────────────────────────────────────────────

const HTS_CHANGE_AFTER_FILING: AuditCheck = {
  id: "HTS_CHANGE_AFTER_FILING",
  name: "HTS Code Changed After Filing",
  description:
    "Checks whether the HTS code on the current product classification has changed since the entry was filed. A change may require a post-entry amendment.",
  severity: "HIGH",
  evaluate(snapshot) {
    if (!snapshot.snapshotHtsCode) return notEvaluated("HTS code at filing is not available in the snapshot.");
    if (!snapshot.currentHtsCode) return notEvaluated("Current HTS code from product classification is not available.");
    if (snapshot.snapshotHtsCode !== snapshot.currentHtsCode) {
      return failResult(
        `HTS code changed from "${snapshot.snapshotHtsCode}" (at filing) to "${snapshot.currentHtsCode}" (current). A post-entry amendment may be required under 19 CFR 173.4.`
      );
    }
    return passResult(`HTS code "${snapshot.snapshotHtsCode}" is unchanged since filing.`);
  },
};

const VALUE_DISCREPANCY: AuditCheck = {
  id: "VALUE_DISCREPANCY",
  name: "Declared Value vs. Final Invoice (> 5%)",
  description:
    "Checks whether the declared customs value differs from the final invoice by more than 5%. A discrepancy may indicate a valuation error requiring a CF-28 or CF-29.",
  severity: "HIGH",
  evaluate(snapshot) {
    if (snapshot.declaredValue == null) return notEvaluated("Declared customs value is not available.");
    if (snapshot.finalInvoiceValue == null) return notEvaluated("Final invoice value is not available.");
    if (snapshot.finalInvoiceValue === 0) return notEvaluated("Final invoice value is zero — cannot compute discrepancy ratio.");
    const pct = Math.abs(snapshot.declaredValue - snapshot.finalInvoiceValue) / snapshot.finalInvoiceValue;
    if (pct > 0.05) {
      return failResult(
        `Declared value $${snapshot.declaredValue.toFixed(2)} differs from final invoice $${snapshot.finalInvoiceValue.toFixed(2)} by ${(pct * 100).toFixed(1)}% (threshold: 5%).`
      );
    }
    return passResult(
      `Declared value $${snapshot.declaredValue.toFixed(2)} is within 5% of final invoice $${snapshot.finalInvoiceValue.toFixed(2)} (diff: ${(pct * 100).toFixed(1)}%).`
    );
  },
};

const ADCVD_COVERAGE: AuditCheck = {
  id: "ADCVD_COVERAGE",
  name: "Active AD/CVD Order Covers HTS Code",
  description:
    "Checks whether a new antidumping or countervailing duty order published after filing covers the HTS code used. If so, supplemental duties may be owed.",
  severity: "CRITICAL",
  evaluate(snapshot) {
    if (snapshot.coveredByAdCvd == null) {
      return notEvaluated(
        "AD/CVD coverage for this HTS code has not been evaluated. Run the AD/CVD order screen against the current order list."
      );
    }
    if (snapshot.coveredByAdCvd) {
      return failResult(
        `HTS code "${snapshot.snapshotHtsCode ?? "unknown"}" is covered by an active AD/CVD order. Review whether supplemental duties apply to this entry.`
      );
    }
    return passResult("No active AD/CVD order covers the HTS code used in this entry.");
  },
};

const BOND_EXPIRY_BEFORE_LIQUIDATION: AuditCheck = {
  id: "BOND_EXPIRY_BEFORE_LIQUIDATION",
  name: "Bond Expired Before Liquidation Date",
  description:
    "Checks whether the bond that was active at entry expired before the expected liquidation date. An expired bond may leave the importer without surety coverage at liquidation.",
  severity: "HIGH",
  evaluate(snapshot) {
    if (!snapshot.bondExpirationDate) return notEvaluated("Bond expiration date is not available.");
    if (!snapshot.liquidationDate) return notEvaluated("Liquidation date is not available.");
    if (snapshot.bondExpirationDate < snapshot.liquidationDate) {
      return failResult(
        `Bond expired ${snapshot.bondExpirationDate.toISOString().slice(0, 10)}, before the liquidation date of ${snapshot.liquidationDate.toISOString().slice(0, 10)}.`
      );
    }
    return passResult(
      `Bond valid until ${snapshot.bondExpirationDate.toISOString().slice(0, 10)}, covering the liquidation date of ${snapshot.liquidationDate.toISOString().slice(0, 10)}.`
    );
  },
};

const BROKER_APPROVAL_FOR_FORMAL_ENTRY: AuditCheck = {
  id: "BROKER_APPROVAL_FOR_FORMAL_ENTRY",
  name: "Classification Approved by Licensed Broker (Formal Entry)",
  description:
    "For entries exceeding the $2,500 formal entry threshold, checks whether the HTS classification was reviewed and approved by a licensed customs broker before filing.",
  severity: "MEDIUM",
  evaluate(snapshot) {
    if (snapshot.overFormalEntryThreshold == null) {
      return notEvaluated("Entry value threshold status (above / below $2,500) is not available.");
    }
    if (!snapshot.overFormalEntryThreshold) {
      return passResult("Entry is below the $2,500 formal entry threshold — licensed broker review is not required.");
    }
    if (snapshot.hasBrokerApproval == null) {
      return notEvaluated("Broker approval status is not available for this entry.");
    }
    if (!snapshot.hasBrokerApproval) {
      return failResult(
        "Entry exceeds $2,500 (formal entry) but the HTS classification was not reviewed by a licensed customs broker."
      );
    }
    return passResult("HTS classification was approved by a licensed customs broker before this formal entry was filed.");
  },
};

// ── Exported checklist and runner ──────────────────────────────────────────────

export const AUDIT_CHECKS: AuditCheck[] = [
  HTS_CHANGE_AFTER_FILING,
  VALUE_DISCREPANCY,
  ADCVD_COVERAGE,
  BOND_EXPIRY_BEFORE_LIQUIDATION,
  BROKER_APPROVAL_FOR_FORMAL_ENTRY,
];

/**
 * Runs every check in the checklist against the supplied snapshot.
 * A new check is a new entry in AUDIT_CHECKS — no code here changes.
 */
export function runAuditChecks(snapshot: FilingSnapshotInput): AuditRunResult[] {
  return AUDIT_CHECKS.map((check) => ({
    checkId: check.id,
    checkName: check.name,
    severity: check.severity,
    result: check.evaluate(snapshot),
  }));
}
