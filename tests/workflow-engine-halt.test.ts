import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));

import { ComplianceWorkflowEngine } from "@/modules/agents/workflowEngine";
import type { AgentState } from "@/modules/agents/agentState";
import type { AgentResult, ComplianceAgent } from "@/modules/agents/complianceAgent";
import type { DocumentIntakeAgentOutput } from "@/modules/intake/documentIntakeAgent";

// A step whose prerequisites never arrive is recorded and skipped, but the
// output assembly needs all ten agents. That used to be a TypeError, then a
// throw the queue worker filed as a job failure and retried forever.

const INPUT = { accountId: "acc_1", userId: "usr_1", shipmentId: "shp_1" };

class StubIntake implements ComplianceAgent {
  readonly name = "Document Intake Agent";
  readonly stepNumber = 1;
  canExecute() {
    return true;
  }
  async execute(state: AgentState): Promise<AgentResult> {
    state.intakeOutput = { packetId: "pkt_1" } as DocumentIntakeAgentOutput;
    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: "Completed",
      confidence: null,
      summary: "ok",
      aiProviderUsed: "TEST",
      decisionId: null,
      output: state.intakeOutput,
    };
  }
}

class StubBlocked implements ComplianceAgent {
  readonly name = "Document Intelligence Agent";
  readonly stepNumber = 2;
  canExecute() {
    return false;
  }
  async execute(): Promise<AgentResult> {
    throw new Error("must not run");
  }
}

function haltedEngine() {
  return new ComplianceWorkflowEngine([new StubIntake(), new StubBlocked()]);
}

describe("ComplianceWorkflowEngine: a run that stops short", () => {
  it("returns a report instead of throwing", async () => {
    const { output } = await haltedEngine().executePipeline(INPUT);

    expect(output.status).toBe("BLOCKED");
    expect(output.userActionStatus).toBe("ACTION_REQUIRED");
    expect(output.haltedAgents).toEqual([
      { stepNumber: 2, name: "Document Intelligence Agent" },
    ]);
  });

  it("names the agent that could not run in the human task", async () => {
    const { output } = await haltedEngine().executePipeline(INPUT);

    expect(output.humanReviewTask?.reason).toContain("Agent 2 (Document Intelligence Agent)");
  });

  it("reports nothing it did not observe", async () => {
    const { output } = await haltedEngine().executePipeline(INPUT);

    expect(output.readiness).toBeNull();
    expect(output.extractedData).toBeNull();
    expect(output.canonicalShipmentState).toBeNull();
    expect(output.mathValidationPassed).toBeNull();
  });

  it("keeps the output of the agent that did run", async () => {
    const { output } = await haltedEngine().executePipeline(INPUT);

    expect(output.packetId).toBe("pkt_1");
    expect(output.agentResults.agent1_intake?.packetId).toBe("pkt_1");
    expect(output.agentResults.agent2_intelligence).toBeUndefined();
  });

  it("counts only the agents that actually executed", async () => {
    const { output } = await haltedEngine().executePipeline(INPUT);

    expect(output.totalAgentsExecuted).toBe(1);
    expect(output.agentsSummary.completed).toBe(1);
    expect(output.agentsSummary.skipped).toBe(1);
  });

  it("does not invent an evaluator refinement count", async () => {
    const { output } = await haltedEngine().executePipeline(INPUT);

    // The completed path used to report `count || 2`, so a genuine 0 read as 2.
    expect(output.evaluatorRefinementsCount).toBe(0);
  });
});
