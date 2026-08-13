/**
 * Verification semantics for the Product Intelligence Agent.
 *
 * Mirrors the pattern in `src/modules/decisions/autoApprovalPolicy.ts`:
 * deterministic corroboration decides the outcome, and LLM confidence alone
 * never promotes a result to AUTO_VERIFIED. A model that reports confidence
 * 95 for an enrichment nobody corroborated against the Product Master is
 * still, at most, agent-proposed — never verified.
 */

import type { ProductMatchResult } from "@/modules/product/productMatching";
import type { ProductConflict, ProductReadiness } from "./comparison";

export type VerificationStatus = "AUTO_VERIFIED" | "AGENT_PROPOSED" | "NEEDS_REVIEW";

/** The subset of AgentDecision.triageState values this agent ever writes. */
export type TriageState = "AUTO_VERIFIED" | "NEEDS_REVIEW";

export interface VerificationInput {
  matchResult: ProductMatchResult;
  conflicts: readonly ProductConflict[];
  missingInformationCount: number;
  readiness: ProductReadiness;
  confidence: number;
}

export interface VerificationResult {
  verificationStatus: VerificationStatus;
  triageState: TriageState;
  reason: string;
}

const POLICY_ID = "product-intelligence-master-v1";
const MIN_CONFIDENCE_FOR_PROPOSAL = 50;

/**
 * AUTO_VERIFIED requires all three: an unambiguous Product Master match,
 * zero conflicts, and no missing classification-relevant information. Any
 * one of those failing means, at best, an agent-proposed value — conflicts
 * and ambiguity always route to NEEDS_REVIEW regardless of how confident the
 * model was.
 */
export function verifyProductIntelligence(input: VerificationInput): VerificationResult {
  const { matchResult, conflicts, missingInformationCount, readiness, confidence } = input;

  if (conflicts.length > 0) {
    return {
      verificationStatus: "NEEDS_REVIEW",
      triageState: "NEEDS_REVIEW",
      reason: `${conflicts.length} conflict(s) between the line item and the Product Master require human review; conflicts are never auto-resolved.`,
    };
  }

  if (matchResult.status === "AMBIGUOUS") {
    return {
      verificationStatus: "NEEDS_REVIEW",
      triageState: "NEEDS_REVIEW",
      reason: "The line item matched more than one Product Master record; ambiguity requires a human to choose.",
    };
  }

  const exactMatch = matchResult.status === "EXACT_MATCH";
  const classificationReady = readiness.classification === "READY";

  if (exactMatch && classificationReady && missingInformationCount === 0) {
    return {
      verificationStatus: "AUTO_VERIFIED",
      triageState: "AUTO_VERIFIED",
      reason: `Exact Product Master match with no conflicts and no missing classification-relevant information (policy ${POLICY_ID}).`,
    };
  }

  if (confidence >= MIN_CONFIDENCE_FOR_PROPOSAL) {
    return {
      verificationStatus: "AGENT_PROPOSED",
      triageState: "NEEDS_REVIEW",
      reason: exactMatch
        ? "Matched to the Product Master, but some classification-relevant information is still missing; proposal requires confirmation."
        : "No corroborating Product Master match; enrichment is agent-proposed from the description alone.",
    };
  }

  return {
    verificationStatus: "NEEDS_REVIEW",
    triageState: "NEEDS_REVIEW",
    reason: `Confidence ${confidence}% is below the ${MIN_CONFIDENCE_FOR_PROPOSAL}% minimum and there is no Product Master corroboration.`,
  };
}
