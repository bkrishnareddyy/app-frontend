import { describe, it, expect } from "vitest";
import { applyAutoApprovalPolicy, type AutoApprovalInput } from "@/modules/decisions/autoApprovalPolicy";

function input(overrides: Partial<AutoApprovalInput> = {}): AutoApprovalInput {
  return {
    confidence: 90,
    partMasterMatch: true,
    partMasterHtsAgrees: true,
    agentName: "HTS Classification Agent",
    ...overrides,
  };
}

describe("applyAutoApprovalPolicy", () => {
  describe("AUTO outcomes", () => {
    it("high confidence + part master agreement → AUTO", () => {
      expect(applyAutoApprovalPolicy(input({ confidence: 85, partMasterMatch: true, partMasterHtsAgrees: true })).outcome).toBe("AUTO");
      expect(applyAutoApprovalPolicy(input({ confidence: 99, partMasterMatch: true, partMasterHtsAgrees: true })).outcome).toBe("AUTO");
    });
  });

  describe("CONFIRM outcomes", () => {
    it("medium confidence (60–84) regardless of part master → CONFIRM", () => {
      expect(applyAutoApprovalPolicy(input({ confidence: 60, partMasterMatch: true, partMasterHtsAgrees: true })).outcome).toBe("CONFIRM");
      expect(applyAutoApprovalPolicy(input({ confidence: 84, partMasterMatch: true, partMasterHtsAgrees: true })).outcome).toBe("CONFIRM");
      expect(applyAutoApprovalPolicy(input({ confidence: 75, partMasterMatch: false, partMasterHtsAgrees: false })).outcome).toBe("CONFIRM");
    });

    it("high confidence without a part master match → CONFIRM", () => {
      expect(applyAutoApprovalPolicy(input({ confidence: 90, partMasterMatch: false, partMasterHtsAgrees: false })).outcome).toBe("CONFIRM");
    });

    it("high confidence with part master match but HTS unresolved → CONFIRM", () => {
      // partMasterMatch=true, partMasterHtsAgrees=false → disagreement → REVIEW, not CONFIRM
      // This case is covered in the REVIEW block below.
    });
  });

  describe("REVIEW outcomes", () => {
    it("low confidence → REVIEW", () => {
      expect(applyAutoApprovalPolicy(input({ confidence: 59 })).outcome).toBe("REVIEW");
      expect(applyAutoApprovalPolicy(input({ confidence: 0 })).outcome).toBe("REVIEW");
    });

    it("null confidence → REVIEW", () => {
      expect(applyAutoApprovalPolicy(input({ confidence: null })).outcome).toBe("REVIEW");
    });

    it("part master match with disagreeing HTS → REVIEW (beats high confidence)", () => {
      expect(applyAutoApprovalPolicy(input({
        confidence: 95,
        partMasterMatch: true,
        partMasterHtsAgrees: false,
      })).outcome).toBe("REVIEW");
    });
  });

  describe("policy metadata", () => {
    it("always returns a stable policyId", () => {
      const a = applyAutoApprovalPolicy(input());
      const b = applyAutoApprovalPolicy(input({ confidence: 30 }));
      expect(a.policyId).toBe(b.policyId);
      expect(a.policyId).toBeTruthy();
    });

    it("always returns a non-empty reason", () => {
      for (const conf of [null, 0, 59, 75, 85, 99]) {
        const result = applyAutoApprovalPolicy(input({ confidence: conf }));
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe("AgentPolicyConfig per-account overrides", () => {
    it("custom autoThreshold and confirmThreshold override default 85/60", () => {
      const customConfig = { autoThreshold: 90, confirmThreshold: 70, requirePartMasterMatch: false };
      // 85 confidence is default AUTO, but under custom config (autoThreshold=90, confirmThreshold=70) it becomes CONFIRM
      expect(applyAutoApprovalPolicy(input({ confidence: 85 }), customConfig).outcome).toBe("CONFIRM");
      // 90 confidence reaches autoThreshold=90 → AUTO
      expect(applyAutoApprovalPolicy(input({ confidence: 90 }), customConfig).outcome).toBe("AUTO");
      // 65 confidence was default CONFIRM (>=60), but under confirmThreshold=70 it becomes REVIEW
      expect(applyAutoApprovalPolicy(input({ confidence: 65 }), customConfig).outcome).toBe("REVIEW");
      // 70 confidence reaches confirmThreshold=70 → CONFIRM
      expect(applyAutoApprovalPolicy(input({ confidence: 70 }), customConfig).outcome).toBe("CONFIRM");
    });

    it("requirePartMasterMatch=true forces REVIEW when part master match is missing even with 99% confidence", () => {
      const customConfig = { autoThreshold: 85, confirmThreshold: 60, requirePartMasterMatch: true };
      expect(
        applyAutoApprovalPolicy(
          input({ confidence: 99, partMasterMatch: false, partMasterHtsAgrees: false }),
          customConfig
        ).outcome
      ).toBe("REVIEW");
    });

    it("custom policy id is preserved when provided in config", () => {
      const customConfig = { id: "policy-override-123", autoThreshold: 80, confirmThreshold: 50 };
      const res = applyAutoApprovalPolicy(input({ confidence: 80 }), customConfig);
      expect(res.policyId).toBe("policy-override-123");
      expect(res.outcome).toBe("AUTO");
    });
  });
});
