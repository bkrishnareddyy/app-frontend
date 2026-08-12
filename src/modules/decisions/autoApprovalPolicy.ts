/**
 * Auto-approval policy.
 *
 * Previously every agent had its own hardcoded confidence threshold with no
 * central record of what threshold fired or whether a part-master match was
 * considered. This made auto-approvals auditor-invisible and the thresholds
 * drift-prone.
 *
 * This module is the single source of truth for when a classification
 * decision requires no human touch. The policy must be:
 *   - Explicit: the caller passes the policy id into the audit log.
 *   - Testable: pure function, no I/O.
 *   - Conservative: a part-master *disagreement* is stronger than low confidence.
 *
 * Auto-approval writes AUTO_VERIFIED, never APPROVED. The distinction matters:
 * APPROVED means a licensed human reviewed it; AUTO_VERIFIED means the policy
 * passed. Auditors and the UI treat these differently.
 */

export type AutoApprovalOutcome = "AUTO" | "CONFIRM" | "REVIEW";

export interface AutoApprovalInput {
  confidence: number | null;
  /** True when the account's product master has an exact part-number match. */
  partMasterMatch: boolean;
  /** True when the part master has a match AND the part master's HTS code agrees with the proposed code. */
  partMasterHtsAgrees: boolean;
  agentName: string;
}

export interface AutoApprovalResult {
  outcome: AutoApprovalOutcome;
  /** Stable id logged to the audit trail so the policy version is always traceable. */
  policyId: string;
  reason: string;
}

/**
 * Current policy: v1.
 *
 * HIGH_CONFIDENCE_WITH_PART_MASTER: confidence ≥ 85 AND part master has a
 *   matching HTS → AUTO (machine already knows the answer; human would just confirm).
 *
 * MEDIUM_OR_UNMATCHED: confidence 60–84, or high confidence without a part
 *   master match → CONFIRM (one-click; the UI should surface the evidence so
 *   the broker can act in under 5 seconds).
 *
 * LOW_OR_DISAGREEMENT: confidence < 60, or part master disagrees with the
 *   proposed code → REVIEW (full two-pane review required).
 *
 * The disagreement case is intentionally conservative: a part master that
 * says 8481.80 and a model that says 8537.10 is not a confidence problem —
 * it is a real conflict that a human must settle.
 */
const POLICY_ID = "hts-auto-v1";
const HIGH_CONFIDENCE_THRESHOLD = 85;
const MEDIUM_CONFIDENCE_THRESHOLD = 60;

export function applyAutoApprovalPolicy(input: AutoApprovalInput): AutoApprovalResult {
  const { confidence, partMasterMatch, partMasterHtsAgrees } = input;

  // Part master disagreement outranks confidence.
  if (partMasterMatch && !partMasterHtsAgrees) {
    return {
      outcome: "REVIEW",
      policyId: POLICY_ID,
      reason: `Part master match found but HTS codes disagree; human review required.`,
    };
  }

  const conf = confidence ?? -1;

  if (conf < MEDIUM_CONFIDENCE_THRESHOLD) {
    return {
      outcome: "REVIEW",
      policyId: POLICY_ID,
      reason: `Confidence ${conf < 0 ? "not recorded" : `${conf}%`} is below the ${MEDIUM_CONFIDENCE_THRESHOLD}% minimum for any auto-handling.`,
    };
  }

  if (conf >= HIGH_CONFIDENCE_THRESHOLD && partMasterMatch && partMasterHtsAgrees) {
    return {
      outcome: "AUTO",
      policyId: POLICY_ID,
      reason: `Confidence ${conf}% ≥ ${HIGH_CONFIDENCE_THRESHOLD}% with part master agreement.`,
    };
  }

  // Medium confidence, or high confidence without a part master match.
  return {
    outcome: "CONFIRM",
    policyId: POLICY_ID,
    reason:
      conf >= HIGH_CONFIDENCE_THRESHOLD
        ? `Confidence ${conf}% is high but no part master match; single-click confirm required.`
        : `Confidence ${conf}% is in the medium range; single-click confirm required.`,
  };
}
