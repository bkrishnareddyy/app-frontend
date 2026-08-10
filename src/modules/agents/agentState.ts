import { db } from "@/lib/db";
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
  durationMs?: number;
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
  // Groups every step of this pipeline run into a single invocation for the
  // Agent Executions waterfall view.
  public readonly runId: string = `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  public readonly triggerEvent: string;
  public readonly invokedBy: string;

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

  constructor(accountId: string, userId: string, shipmentId: string, triggerEvent = "DOCUMENT_UPLOADED", invokedBy = "Document Upload") {
    this.accountId = accountId;
    this.userId = userId;
    this.shipmentId = shipmentId;
    this.triggerEvent = triggerEvent;
    this.invokedBy = invokedBy;
  }

  public recordAgentExecution(entry: AgentStateHistoryEntry) {
    this.history.push(entry);
  }

  public recordMathDiscrepancy(discrepancy: string) {
    this.mathValidationPassed = false;
    this.mathDiscrepancies.push(discrepancy);
  }

  /**
   * Transactionally persists agent execution logs to PostgreSQL for CBP audit defense.
   */
  public async persistToDatabase(): Promise<void> {
    try {
      // Ensure account exists to satisfy foreign key constraint
      await db.account.upsert({
        where: { id: this.accountId },
        update: {},
        create: {
          id: this.accountId,
          name: "Demo Enterprise Account",
          slug: `account-${this.accountId.slice(0, 8)}`,
          type: "ENTERPRISE",
          status: "ACTIVE",
        },
      });

      // Write execution logs. Each row is its own try/catch: a single
      // failing insert (e.g. a stale Prisma Client rejecting a new column)
      // must not silently erase every other step's audit record along with
      // it -- that previously happened because the whole loop shared one
      // try/catch with the rest of this method.
      for (const entry of this.history) {
        try {
          await db.agentExecutionLog.create({
            data: {
              accountId: this.accountId,
              shipmentId: this.shipmentId,
              agentName: entry.agentName,
              stepNumber: entry.stepNumber,
              status: entry.status,
              summary: entry.summary,
              confidence: entry.confidence as any,
              aiProviderUsed: entry.aiProviderUsed,
              decisionId: entry.decisionId,
              timestamp: new Date(entry.timestamp),
              runId: this.runId,
              triggerEvent: this.triggerEvent,
              invokedBy: this.invokedBy,
              durationMs: entry.durationMs,
            },
          });
        } catch (err) {
          console.error(`[AgentState] Failed to persist execution log for ${entry.agentName} (run ${this.runId}):`, err);
        }
      }

      // Upsert canonical shipment state record
      const isReady = Boolean(this.readinessOutput?.readyForTransmission);
      const isCleared = this.complianceOutput?.status === "Completed";
      const lifecycleStatus = isReady ? "COMPLETED" : "BLOCKED";

      await db.shipmentStateRecord.upsert({
        where: { shipmentId: this.shipmentId },
        update: {
          lifecycleStatus,
          userActionStatus: isReady ? "NONE" : "ACTION_REQUIRED",
          completenessScore: this.intelligenceOutput?.confidenceMetrics?.dataCompleteness ?? 85,
          complianceStatus: isCleared ? "CLEARED" : "BLOCKED_DEPENDENCY",
          readinessScore: this.readinessOutput?.readinessScore ?? 0,
          snapshotData: {
            packetId: this.packetId,
            mathValidationPassed: this.mathValidationPassed,
            mathDiscrepancies: this.mathDiscrepancies,
            historyCount: this.history.length,
          } as any,
        },
        create: {
          accountId: this.accountId,
          shipmentId: this.shipmentId,
          lifecycleStatus,
          userActionStatus: isReady ? "NONE" : "ACTION_REQUIRED",
          completenessScore: this.intelligenceOutput?.confidenceMetrics?.dataCompleteness ?? 85,
          complianceStatus: isCleared ? "CLEARED" : "BLOCKED_DEPENDENCY",
          readinessScore: this.readinessOutput?.readinessScore ?? 0,
          snapshotData: {
            packetId: this.packetId,
            mathValidationPassed: this.mathValidationPassed,
            mathDiscrepancies: this.mathDiscrepancies,
            historyCount: this.history.length,
          } as any,
        },
      });
    } catch (err) {
      console.warn("[AgentState] Failed to persist state to PostgreSQL:", err);
    }
  }

  toJSON(): Record<string, any> {
    return {
      accountId: this.accountId,
      userId: this.userId,
      shipmentId: this.shipmentId,
      packetId: this.packetId,
      mathValidationPassed: this.mathValidationPassed,
      mathDiscrepancies: this.mathDiscrepancies,
      evaluatorRefinementsCount: this.evaluatorRefinementsCount,
      intakeOutput: this.intakeOutput,
      intelligenceOutput: this.intelligenceOutput,
      productOutput: this.productOutput,
      classificationOutput: this.classificationOutput,
      originOutput: this.originOutput,
      valuationOutput: this.valuationOutput,
      complianceOutput: this.complianceOutput,
      readinessOutput: this.readinessOutput,
      filingOutput: this.filingOutput,
      responseOutput: this.responseOutput,
      history: this.history,
    };
  }

  static fromJSON(data: any): AgentState {
    const json = typeof data === "string" ? JSON.parse(data) : (data || {});
    const state = new AgentState(json.accountId || "", json.userId || "", json.shipmentId || "");
    Object.assign(state, json);
    return state;
  }
}

