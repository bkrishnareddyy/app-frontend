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
    const engine = new ComplianceWorkflowEngine();
    const { output } = await engine.executePipeline(input);
    return output;
  }
}
