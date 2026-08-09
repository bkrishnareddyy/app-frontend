import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
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
  status: "Completed" | "Review Required" | "Attention" | "BLOCKED";
  summary: string;
  /** Null when the agent reported no confidence. Never substitute a figure. */
  confidence: number | MultiDimensionalConfidence | null;
  aiProviderUsed: string;
  /** Null when no AgentDecision row was persisted. Never substitute a synthetic id. */
  decisionId: string | null;
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

  /**
   * Transactionally persists agent execution logs to PostgreSQL for CBP audit defense.
   */
  public async persistToDatabase(): Promise<void> {
    try {
      // This used to upsert the account first "to satisfy the foreign key", which
      // turned an unknown accountId into a live ACTIVE ENTERPRISE tenant named
      // "Demo Enterprise Account" with no owner and no membership. The foreign key
      // is the tenant integrity check; let it fail.

      // Write execution logs
      for (const entry of this.history) {
        await db.agentExecutionLog.create({
          data: {
            accountId: this.accountId,
            shipmentId: this.shipmentId,
            agentName: entry.agentName,
            stepNumber: entry.stepNumber,
            status: entry.status,
            summary: entry.summary,
            confidence: (entry.confidence ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            aiProviderUsed: entry.aiProviderUsed,
            // The column is a non-null String, so "no decision persisted" records as
            // empty rather than a synthetic id. Making it nullable needs a migration.
            decisionId: entry.decisionId ?? "",
            timestamp: new Date(entry.timestamp),
          },
        });
      }

      // Upsert canonical shipment state record
      const isReady = Boolean(this.readinessOutput?.readyForTransmission);
      const isCleared = this.complianceOutput?.status === "Completed";
      const lifecycleStatus = isReady ? "COMPLETED" : "BLOCKED";
      // The column is a non-null Int, so an uncomputed score records as 0 rather than
      // an invented figure. Making it nullable needs a migration.
      const completenessScore = this.intelligenceOutput?.confidenceMetrics?.dataCompleteness ?? 0;
      const snapshotData: Prisma.InputJsonObject = {
        packetId: this.packetId,
        mathValidationPassed: this.mathValidationPassed,
        mathDiscrepancies: this.mathDiscrepancies,
        historyCount: this.history.length,
      };

      await db.shipmentStateRecord.upsert({
        where: { shipmentId: this.shipmentId },
        update: {
          lifecycleStatus,
          userActionStatus: isReady ? "NONE" : "ACTION_REQUIRED",
          completenessScore,
          complianceStatus: isCleared ? "CLEARED" : "BLOCKED_DEPENDENCY",
          readinessScore: this.readinessOutput?.readinessScore ?? 0,
          snapshotData,
        },
        create: {
          accountId: this.accountId,
          shipmentId: this.shipmentId,
          lifecycleStatus,
          userActionStatus: isReady ? "NONE" : "ACTION_REQUIRED",
          completenessScore,
          complianceStatus: isCleared ? "CLEARED" : "BLOCKED_DEPENDENCY",
          readinessScore: this.readinessOutput?.readinessScore ?? 0,
          snapshotData,
        },
      });
    } catch (err) {
      console.warn("[AgentState] Failed to persist state to PostgreSQL:", err);
    }
  }

  toJSON(): Record<string, unknown> {
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

  static fromJSON(data: unknown): AgentState {
    const json: Record<string, unknown> =
      typeof data === "string" ? JSON.parse(data) : ((data as Record<string, unknown>) ?? {});
    const state = new AgentState(
      typeof json.accountId === "string" ? json.accountId : "",
      typeof json.userId === "string" ? json.userId : "",
      typeof json.shipmentId === "string" ? json.shipmentId : ""
    );
    Object.assign(state, json);
    return state;
  }
}

