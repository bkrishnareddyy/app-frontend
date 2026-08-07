import { DocumentIntakeAgentOutput } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceOutput } from "./documentIntelligenceAgent";
import { ProductIntelligenceOutput } from "./productIntelligenceAgent";
import { HTSClassificationOutput } from "./htsClassificationAgent";
import { OriginRulesOutput } from "./originRulesAgent";
import { ValuationAssistsOutput } from "./valuationAssistsAgent";
import { ComplianceAuditOutput } from "./complianceAuditAgent";
import { FilingReadinessOutput } from "./filingReadinessAgent";
import { CustomsFilingOutput } from "./customsFilingAgent";
import { ResponseManagementOutput } from "./responseManagementAgent";

export interface MultiDimensionalConfidence {
  dataConfidence?: number;
  ruleConfidence?: number;
  decisionConfidence?: number;
  extractionConfidence?: number;
  dataCompleteness?: number;
  filingConfidence?: number;
}

export interface AgentDependencyMetadata {
  inputsRequired: string[];
  inputsReceived: string[];
  missingInputs: string[];
  blockedByAgents: string[];
}

export interface CanonicalShipmentState {
  shipmentId: string;
  lifecycleStatus: "COMPLETED" | "BLOCKED" | "REVIEW_REQUIRED";
  userActionStatus: "ACTION_REQUIRED" | "NONE";
  completeness: {
    score: number;
    missingFields: string[];
  };
  compliance: {
    status: "CLEARED" | "BLOCKED_DEPENDENCY" | "REVIEW_REQUIRED";
    reason: string;
  };
  filing: {
    status: "READY" | "NOT_READY";
    blockersCount: number;
  };
  confidence: {
    extraction: number;
    completeness: number;
    filing: number;
  };
  humanTasksCount: number;
}

export interface AgentStateHistoryEntry {
  agentName: string;
  stepNumber: number;
  timestamp: string;
  status: "Completed" | "Review Required" | "Attention";
  summary: string;
  confidence: number | MultiDimensionalConfidence;
  aiProviderUsed: string;
  decisionId: string;
}

/**
 * Immutable AgentState container passed across Agents 1-10 (Google ADK Pattern).
 * Maintains full execution history, math verification logs, and audit trail lineage.
 */
export class AgentState {
  public readonly accountId: string;
  public readonly userId: string;
  public readonly shipmentId: string;
  public packetId: string = "";
  public readonly createdAt: string = new Date().toISOString();

  // Shared state accumulators
  public history: AgentStateHistoryEntry[] = [];
  public mathValidationPassed: boolean = true;
  public mathDiscrepancies: string[] = [];
  public evaluatorRefinementsCount: number = 0;

  // Agent outputs context store
  public intakeOutput?: DocumentIntakeAgentOutput;
  public intelligenceOutput?: DocumentIntelligenceOutput;
  public productOutput?: ProductIntelligenceOutput;
  public classificationOutput?: HTSClassificationOutput;
  public originOutput?: OriginRulesOutput;
  public valuationOutput?: ValuationAssistsOutput;
  public complianceOutput?: ComplianceAuditOutput;
  public readinessOutput?: FilingReadinessOutput;
  public filingOutput?: CustomsFilingOutput;
  public responseOutput?: ResponseManagementOutput;

  constructor(accountId: string, userId: string, shipmentId: string) {
    this.accountId = accountId;
    this.userId = userId;
    this.shipmentId = shipmentId;
  }

  public recordAgentExecution(entry: AgentStateHistoryEntry) {
    this.history.push(entry);
  }

  public recordMathDiscrepancy(discrepancy: string) {
    this.mathValidationPassed = false;
    this.mathDiscrepancies.push(discrepancy);
  }
}
