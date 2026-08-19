import { describe, it, expect } from "vitest";
import {
  normalizeDecisionStatus,
  actionableStatusVariants,
  statusVariantsForState,
  statusVariantsForStates,
  getActionableDecisionWhereFilter,
  getAllReviewableDecisionWhereFilter,
  triageDecision,
} from "./decisionState";

describe("decisionState module", () => {
  it("normalizes canonical and legacy decision status strings", () => {
    expect(normalizeDecisionStatus("NEEDS_REVIEW")).toBe("NEEDS_REVIEW");
    expect(normalizeDecisionStatus("Needs Review")).toBe("NEEDS_REVIEW");
    expect(normalizeDecisionStatus("Review Required")).toBe("NEEDS_REVIEW");
    expect(normalizeDecisionStatus("Attention")).toBe("NEEDS_REVIEW");
    expect(normalizeDecisionStatus("Pending")).toBe("NEEDS_REVIEW");

    expect(normalizeDecisionStatus("BLOCKED_DEPENDENCY")).toBe("BLOCKED");
    expect(normalizeDecisionStatus("WAITING_FOR_EXTRACTION")).toBe("BLOCKED");
    expect(normalizeDecisionStatus("Skipped")).toBe("BLOCKED");
    expect(normalizeDecisionStatus("Paused")).toBe("BLOCKED");

    expect(normalizeDecisionStatus("Auto-Approved")).toBe("AUTO_VERIFIED");
    expect(normalizeDecisionStatus("Verified")).toBe("AUTO_VERIFIED");
  });

  it("returns all status variants for a target state", () => {
    const reviewVariants = statusVariantsForState("NEEDS_REVIEW");
    expect(reviewVariants).toContain("NEEDS_REVIEW");
    expect(reviewVariants).toContain("Needs Review");
    expect(reviewVariants).toContain("Review Required");
    expect(reviewVariants).toContain("Attention");
    expect(reviewVariants).toContain("Pending");

    const multiStateVariants = statusVariantsForStates(["NEEDS_REVIEW", "BLOCKED"]);
    expect(multiStateVariants).toContain("NEEDS_REVIEW");
    expect(multiStateVariants).toContain("BLOCKED");
    expect(multiStateVariants).toContain("Skipped");
  });

  it("builds consistent actionable decision Prisma filter", () => {
    const filter = getActionableDecisionWhereFilter();
    expect(filter.OR).toHaveLength(2);
    const [first, second] = filter.OR as Array<Record<string, any>>;
    expect(first).toEqual({ triageState: { in: ["NEEDS_REVIEW", "BLOCKED"] } });
    expect(second.triageState).toBeNull();
    expect(second.status.in).toEqual(expect.arrayContaining(actionableStatusVariants()));
  });

  it("builds consistent reviewable decision Prisma filter for human queues", () => {
    const filter = getAllReviewableDecisionWhereFilter();
    expect(filter.OR).toHaveLength(2);
    const [first] = filter.OR as Array<Record<string, any>>;
    expect(first.triageState.in).toEqual(
      expect.arrayContaining(["NEEDS_REVIEW", "AUTO_VERIFIED", "BLOCKED", "APPROVED", "REJECTED"])
    );
  });

  it("triages decision categories correctly", () => {
    expect(
      triageDecision({ status: "Needs Review", triageState: "NEEDS_REVIEW" })
    ).toBe("review");

    expect(
      triageDecision({ status: "BLOCKED", triageState: "BLOCKED" })
    ).toBe("blocked");

    expect(
      triageDecision({ status: "APPROVED", triageState: "APPROVED" })
    ).toBe("verified");
  });
});
