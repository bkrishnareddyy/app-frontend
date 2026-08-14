import { db } from "@/lib/db";

export type AutoApprovalOutcome = "AUTO" | "CONFIRM" | "REVIEW";

export interface AgentPolicyConfigLike {
  id?: string;
  policyType?: string | null;
  autoThreshold?: number | null;
  confirmThreshold?: number | null;
  requirePartMasterMatch?: boolean | null;
  requireHumanApproval?: boolean | null;
  minimumReviewerRole?: string | null;
}

export interface AutoApprovalInput {
  confidence: number | null;
  /** True when the account's product master has an exact part-number match. */
  partMasterMatch: boolean;
  /** True when the part master has a match AND the part master's HTS code agrees with the proposed code. */
  partMasterHtsAgrees: boolean;
  agentName: string;
  /** Optional per-account AgentPolicyConfig override. */
  policyConfig?: AgentPolicyConfigLike | null;
}

export interface AutoApprovalResult {
  outcome: AutoApprovalOutcome;
  /** Stable id logged to the audit trail so the policy version is always traceable. */
  policyId: string;
  reason: string;
}

const POLICY_ID = "hts-auto-v1";
const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 85;
const DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD = 60;

/**
 * Fetch the account's AgentPolicyConfig override for a given agent name.
 */
export async function getAgentPolicyConfig(
  accountId: string,
  agentName: string
): Promise<AgentPolicyConfigLike | null> {
  const possibleNames = Array.from(
    new Set([
      agentName,
      agentName.replace(/\s+/g, "_").toUpperCase(),
      agentName.replace(/_/g, " "),
      "HTS_CLASSIFICATION",
      "HTS Classification Agent",
    ])
  );
  try {
    return await db.agentPolicyConfig.findFirst({
      where: {
        accountId,
        agentName: { in: possibleNames },
      },
    });
  } catch {
    return null;
  }
}

export function applyAutoApprovalPolicy(
  input: AutoApprovalInput,
  configOverride?: AgentPolicyConfigLike | null
): AutoApprovalResult {
  const { confidence, partMasterMatch, partMasterHtsAgrees } = input;
  const config = configOverride ?? input.policyConfig;

  const policyId = config?.id ?? POLICY_ID;
  const highThreshold = config?.autoThreshold ?? DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
  const mediumThreshold = config?.confirmThreshold ?? DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD;
  const requirePartMaster = config?.requirePartMasterMatch ?? false;

  // STAGE_GATE policy type or explicit requireHumanApproval forces REVIEW
  if (config?.policyType === "STAGE_GATE" || config?.requireHumanApproval) {
    return {
      outcome: "REVIEW",
      policyId,
      reason: `Stage-gate policy requires human review by ${config.minimumReviewerRole ?? "SPECIALIST"} or above.`,
    };
  }

  // Part master disagreement outranks confidence.
  if (partMasterMatch && !partMasterHtsAgrees) {
    return {
      outcome: "REVIEW",
      policyId,
      reason: `Part master match found but HTS codes disagree; human review required.`,
    };
  }

  // Explicit policy requiring part master match forces REVIEW if missing
  if (requirePartMaster && !partMasterMatch) {
    return {
      outcome: "REVIEW",
      policyId,
      reason: `Part master match is required by agent policy but missing; human review required.`,
    };
  }

  const conf = confidence ?? -1;

  if (conf < mediumThreshold) {
    return {
      outcome: "REVIEW",
      policyId,
      reason: `Confidence ${conf < 0 ? "not recorded" : `${conf}%`} is below the ${mediumThreshold}% minimum for any auto-handling.`,
    };
  }

  if (conf >= highThreshold && partMasterMatch && partMasterHtsAgrees) {
    return {
      outcome: "AUTO",
      policyId,
      reason: `Confidence ${conf}% ≥ ${highThreshold}% with part master agreement.`,
    };
  }

  // Medium confidence, or high confidence without a part master match.
  return {
    outcome: "CONFIRM",
    policyId,
    reason:
      conf >= highThreshold
        ? `Confidence ${conf}% is high but no part master match; single-click confirm required.`
        : `Confidence ${conf}% is in the medium range; single-click confirm required.`,
  };
}
