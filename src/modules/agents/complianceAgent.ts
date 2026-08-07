import { AgentState } from "./agentState";

export interface RequiredFieldRequirement {
  field: string;
  reason: string;
}

export interface HumanReviewTask {
  taskId: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  assignedTeam: string;
  reason: string;
  requiredAction: string;
  requiredFields: RequiredFieldRequirement[];
  slaHours: number;
}

export interface BlockerDetail {
  code: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  ownerAgent: string;
  causedBy: string[];
  message: string;
}

export interface AgentResult<TOutput = any> {
  agentName: string;
  stepNumber: number;
  status: "Completed" | "Review Required" | "Attention" | "BLOCKED" | string;
  confidence: number | Record<string, number>;
  summary: string;
  aiProviderUsed: string;
  decisionId: string;
  output: TOutput;
  blockers?: BlockerDetail[];
  humanReviewTask?: HumanReviewTask | null;
}

/**
 * ComplianceAgent interface: Pluggable contract for autonomous agents in the Qubere engine.
 * Enables modular execution, dependency gating, and standardized validation.
 */
export interface ComplianceAgent<TInput = any, TOutput = any> {
  readonly name: string;
  readonly stepNumber: number;

  /** Checks whether prerequisite data and agent state dependencies are satisfied. */
  canExecute(state: AgentState): boolean;

  /** Executes the agent logic against current AgentState context. */
  execute(state: AgentState, input?: TInput): Promise<AgentResult<TOutput>>;

  /** Validates agent output metrics and business rule constraints. */
  validate?(result: AgentResult<TOutput>, state: AgentState): boolean;
}
