import { describe, expect, it, vi } from "vitest";
import { applyAutoApprovalPolicy } from "@/modules/decisions/autoApprovalPolicy";
import { AuditAction } from "@/lib/audit";

describe("Auto-Approval Audit Logging", () => {
  it("defines AuditAction.DECISION_AUTO_APPROVED as a valid typed enum value", () => {
    expect(AuditAction.DECISION_AUTO_APPROVED).toBe("DECISION_AUTO_APPROVED");
  });

  it("returns AUTO outcome when confidence is high and part master matches and agrees", () => {
    const result = applyAutoApprovalPolicy({
      confidence: 95,
      partMasterMatch: true,
      partMasterHtsAgrees: true,
      agentName: "HTS Classification Agent",
    });

    expect(result.outcome).toBe("AUTO");
    expect(result.policyId).toBeTruthy();
    expect(result.reason).toContain("95%");
  });

  it("returns REVIEW outcome when part master match disagrees", () => {
    const result = applyAutoApprovalPolicy({
      confidence: 95,
      partMasterMatch: true,
      partMasterHtsAgrees: false,
      agentName: "HTS Classification Agent",
    });

    expect(result.outcome).toBe("REVIEW");
    expect(result.reason).toContain("HTS codes disagree");
  });

  it("maps AUTO outcome directly to AuditAction.DECISION_AUTO_APPROVED string action", () => {
    const result = applyAutoApprovalPolicy({
      confidence: 90,
      partMasterMatch: true,
      partMasterHtsAgrees: true,
      agentName: "HTS Classification Agent",
    });

    const action = result.outcome === "AUTO" ? AuditAction.DECISION_AUTO_APPROVED : AuditAction.AGENT_EXECUTION_COMPLETED;
    expect(action).toBe(AuditAction.DECISION_AUTO_APPROVED);
  });
});
