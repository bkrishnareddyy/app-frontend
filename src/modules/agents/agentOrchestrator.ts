import {
  ComplianceWorkflowEngine,
  PipelineOrchestrationInput,
  PipelineOrchestrationOutput,
} from "./workflowEngine";
import {
  RequiredFieldRequirement,
  HumanReviewTask,
  BlockerDetail,
} from "./complianceAgent";

export type {
  PipelineOrchestrationInput,
  PipelineOrchestrationOutput,
  RequiredFieldRequirement,
  HumanReviewTask,
  BlockerDetail,
};

/**
 * AgentOrchestrator: High-level entry point for Qubere Multi-Agent Clearance Engine.
 * Delegates execution to the decoupled ComplianceWorkflowEngine.
 */
export class AgentOrchestrator {
  /**
   * Runs the full 10-agent trade compliance workflow via ComplianceWorkflowEngine.
   */
  static async runFullPipeline(input: PipelineOrchestrationInput): Promise<PipelineOrchestrationOutput> {
    console.log(`\n================================================================================`);
    console.log(`🤖 [Qubere Agent Pipeline] INITIALIZING 10-AGENT AUTONOMOUS WORKFLOW`);
    console.log(`📦 Shipment ID: ${input.shipmentId} | Account: ${input.accountId} | File: ${input.fileName || "N/A"}`);
    console.log(`================================================================================\n`);

    const startTime = Date.now();
    const engine = new ComplianceWorkflowEngine();
    const { output } = await engine.executePipeline(input);
    const totalMs = Date.now() - startTime;

    console.log(`\n================================================================================`);
    console.log(`🏁 [Qubere Agent Pipeline] WORKFLOW FINISHED in ${totalMs}ms`);
    console.log(`📊 Status: ${output.pipelineStatus} | Readiness Score: ${output.readiness.score}% | Completed: ${output.agentsSummary.completed}/10`);
    console.log(`================================================================================\n`);

    return output;
  }
}

