import { describe, it, expect } from "vitest";
import {
  ACTIONABLE_DECISION_STATES,
  normalizeDecisionStatus,
  isActionableDecisionState,
  isTerminalDecisionState,
  isAutoVerified,
  isHumanApproved,
  actionableStatusVariants,
  triageDecision,
  decisionStateLabel,
  type DecisionState,
} from "@/modules/decisions/decisionState";

// Every raw literal an agent has ever written maps to a known state and
// does not silently fall off the queue.
const AGENT_LITERALS: [string, DecisionState][] = [
  ["Needs Review", "NEEDS_REVIEW"],
  ["Review Required", "NEEDS_REVIEW"],
  ["Attention", "NEEDS_REVIEW"],
  ["Pending", "NEEDS_REVIEW"],
  ["Approved", "APPROVED"],
  ["Rejected", "REJECTED"],
  ["In Progress", "IN_PROGRESS"],
  ["Completed", "COMPLETED"],
  // Blocked sentinels written as status values
  ["BLOCKED_DEPENDENCY", "BLOCKED"],
  ["WAITING_FOR_EXTRACTION", "BLOCKED"],
  ["BLOCKED_MISSING_DESCRIPTION", "BLOCKED"],
  ["Skipped", "BLOCKED"],
  ["Skipped - Missing Invoice Data", "BLOCKED"],
  ["Paused", "BLOCKED"],
  ["COMPLETED_NO_ACTION", "COMPLETED"],
  // Legacy approval strings
  ["Auto-Approved", "AUTO_VERIFIED"],
  ["Verified", "AUTO_VERIFIED"],
  // Canonical canonical canonical
  ["NEEDS_REVIEW", "NEEDS_REVIEW"],
  ["AUTO_VERIFIED", "AUTO_VERIFIED"],
  ["BLOCKED", "BLOCKED"],
  ["APPROVED", "APPROVED"],
  ["REJECTED", "REJECTED"],
  ["IN_PROGRESS", "IN_PROGRESS"],
  ["COMPLETED", "COMPLETED"],
];

describe("normalizeDecisionStatus", () => {
  it.each(AGENT_LITERALS)("maps %s → %s", (raw, expected) => {
    expect(normalizeDecisionStatus(raw)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(normalizeDecisionStatus("needs review")).toBe("NEEDS_REVIEW");
    expect(normalizeDecisionStatus("NEEDS REVIEW")).toBe("NEEDS_REVIEW");
    expect(normalizeDecisionStatus("approved")).toBe("APPROVED");
  });

  it("returns null for unknown values", () => {
    expect(normalizeDecisionStatus("some-future-agent-status")).toBeNull();
    expect(normalizeDecisionStatus("")).toBeNull();
    expect(normalizeDecisionStatus(null)).toBeNull();
    expect(normalizeDecisionStatus(undefined)).toBeNull();
  });
});

describe("actionable state detection", () => {
  it("NEEDS_REVIEW is actionable", () => {
    expect(isActionableDecisionState("NEEDS_REVIEW")).toBe(true);
  });
  it("BLOCKED is actionable", () => {
    expect(isActionableDecisionState("BLOCKED")).toBe(true);
  });
  it("APPROVED is not actionable", () => {
    expect(isActionableDecisionState("APPROVED")).toBe(false);
  });
  it("AUTO_VERIFIED is not actionable", () => {
    expect(isActionableDecisionState("AUTO_VERIFIED")).toBe(false);
  });
  it("REJECTED is not actionable", () => {
    expect(isActionableDecisionState("REJECTED")).toBe(false);
  });
});

describe("terminal state detection", () => {
  it("APPROVED, AUTO_VERIFIED, REJECTED are terminal", () => {
    expect(isTerminalDecisionState("APPROVED")).toBe(true);
    expect(isTerminalDecisionState("AUTO_VERIFIED")).toBe(true);
    expect(isTerminalDecisionState("REJECTED")).toBe(true);
  });
  it("NEEDS_REVIEW and BLOCKED are not terminal", () => {
    expect(isTerminalDecisionState("NEEDS_REVIEW")).toBe(false);
    expect(isTerminalDecisionState("BLOCKED")).toBe(false);
  });
});

describe("isAutoVerified / isHumanApproved", () => {
  it("distinguishes machine from human approval", () => {
    expect(isAutoVerified("AUTO_VERIFIED")).toBe(true);
    expect(isAutoVerified("APPROVED")).toBe(false);
    expect(isHumanApproved("APPROVED")).toBe(true);
    expect(isHumanApproved("AUTO_VERIFIED")).toBe(false);
  });
});

describe("actionableStatusVariants", () => {
  it("includes every known legacy string that maps to an actionable state", () => {
    const variants = new Set(actionableStatusVariants());
    const actionableLiterals = AGENT_LITERALS
      .filter(([, state]) => ACTIONABLE_DECISION_STATES.includes(state))
      .map(([raw]) => raw);

    for (const lit of actionableLiterals) {
      expect(variants.has(lit)).toBe(true);
    }
  });

  it("does not include APPROVED", () => {
    const variants = actionableStatusVariants();
    expect(variants).not.toContain("Approved");
    expect(variants).not.toContain("APPROVED");
  });

  it("does not include COMPLETED", () => {
    const variants = actionableStatusVariants();
    expect(variants).not.toContain("Completed");
    expect(variants).not.toContain("COMPLETED");
  });
});

describe("triageDecision", () => {
  it("blocked sentinel in proposedDescription → blocked", () => {
    expect(triageDecision({ status: "Needs Review", proposedDescription: "BLOCKED_DEPENDENCY" })).toBe("blocked");
    expect(triageDecision({ status: "Approved", proposedDescription: "WAITING_FOR_EXTRACTION" })).toBe("blocked");
    expect(triageDecision({ status: "Approved", proposedDescription: "BLOCKED_MISSING_DESCRIPTION" })).toBe("blocked");
  });

  it("APPROVED → verified", () => {
    expect(triageDecision({ status: "Approved" })).toBe("verified");
  });
  it("AUTO_VERIFIED → verified", () => {
    expect(triageDecision({ status: "AUTO_VERIFIED" })).toBe("verified");
    expect(triageDecision({ status: "Auto-Approved" })).toBe("verified");
  });
  it("legacy Needs Review / Review Required → review", () => {
    expect(triageDecision({ status: "Needs Review" })).toBe("review");
    expect(triageDecision({ status: "Review Required" })).toBe("review");
    expect(triageDecision({ status: "Attention" })).toBe("review");
    expect(triageDecision({ status: "Pending" })).toBe("review");
  });
  it("BLOCKED status → blocked", () => {
    expect(triageDecision({ status: "BLOCKED_DEPENDENCY" })).toBe("blocked");
    expect(triageDecision({ status: "Skipped" })).toBe("blocked");
  });
  it("REJECTED → blocked (still needs broker action)", () => {
    expect(triageDecision({ status: "Rejected" })).toBe("blocked");
  });
  it("unknown status → review (show to a human)", () => {
    expect(triageDecision({ status: "some-unknown-future-value" })).toBe("review");
  });
});

describe("decisionStateLabel", () => {
  it("auto-verified and approved have distinct labels", () => {
    expect(decisionStateLabel("AUTO_VERIFIED")).not.toBe(decisionStateLabel("APPROVED"));
    expect(decisionStateLabel("AUTO_VERIFIED")).toBe("Auto-Verified");
    expect(decisionStateLabel("APPROVED")).toBe("Approved");
  });

  it("covers all states", () => {
    const allStates: DecisionState[] = [
      "NEEDS_REVIEW", "AUTO_VERIFIED", "BLOCKED",
      "APPROVED", "REJECTED", "IN_PROGRESS", "COMPLETED",
    ];
    for (const state of allStates) {
      expect(typeof decisionStateLabel(state)).toBe("string");
      expect(decisionStateLabel(state).length).toBeGreaterThan(0);
    }
  });
});
