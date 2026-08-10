import { db } from "@/lib/db";
import { ReconciliationEngine } from "@/modules/shipment/reconciliationEngine";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { DocumentIntakeAgent } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent } from "./documentIntelligenceAgent";
import { HTSClassificationAgent } from "./htsClassificationAgent";
import { OriginRulesAgent } from "./originRulesAgent";
import { ValuationAssistsAgent } from "./valuationAssistsAgent";
import { ComplianceAuditAgent } from "./complianceAuditAgent";
import { FilingReadinessAgent } from "./filingReadinessAgent";
import { ShipmentEventBus, ShipmentEventType } from "@/modules/events/shipmentEventBus";

/**
 * The fields the dependency graph and the agent invocations actually read.
 * The index signature is what lets the whole payload be logged verbatim to the
 * event bus, so callers may attach extra trigger metadata alongside these keys.
 */
export interface AgentTriggerPayload {
  field?: string;
  newValue?: string | null;
  documentId?: string;
  fileName?: string;
  fileUrl?: string;
  productProfiles?: Parameters<typeof HTSClassificationAgent.execute>[0]["productProfiles"];
  lineItems?: Parameters<typeof OriginRulesAgent.execute>[0]["lineItems"];
  [key: string]: unknown;
}

export interface AgentOrchestrationParams {
  shipmentId: string;
  accountId: string;
  userId?: string;
  triggerEvent: ShipmentEventType;
  payload?: AgentTriggerPayload;
}

export interface AgentOrchestrationResult {
  shipmentId: string;
  triggerEvent: ShipmentEventType;
  agentsExecuted: string[];
  durationMs: number;
  canonicalState: Awaited<ReturnType<typeof CanonicalShipmentService.getCanonicalState>>;
}

export class AgentDependencyOrchestrator {
  /**
   * Selective dependency-aware execution engine.
   * Executes ONLY the agents affected by the specific trigger event.
   */
  static async processEvent(params: AgentOrchestrationParams): Promise<AgentOrchestrationResult> {
    const startTime = Date.now();
    const { shipmentId, triggerEvent, payload } = params;

    const invokedByLabel =
      triggerEvent === "USER_FIELD_UPDATED"
        ? `User (${payload?.field ? `Edit ${payload.field}` : "Manual Edit"})`
        : triggerEvent === "DOCUMENT_UPLOADED"
        ? "Document Upload Intake"
        : "Reconciliation Engine";

    console.log(`🤖 [AgentDependencyOrchestrator] Invoked by [${invokedByLabel}] for Shipment ${shipmentId}`);

    // Log incoming domain event
    await ShipmentEventBus.logEvent({
      shipmentId,
      eventType: triggerEvent,
      payload,
      triggeredBy: params.userId || "SYSTEM",
    });

    // Determine target agents to execute based on trigger event & dependency graph
    const agentsToRun = this.determineAgentsToRun(triggerEvent, payload);
    const executedAgents: string[] = [];

    for (let i = 0; i < agentsToRun.length; i++) {
      const agentName = agentsToRun[i];
      const nextStep = i < agentsToRun.length - 1 ? agentsToRun[i + 1] : "Clearance Verification Complete";
      const agentStart = new Date();
      const startMs = Date.now();

      let status = "COMPLETED";
      let error: string | undefined;

      try {
        await this.runSingleAgent(agentName, params);
        executedAgents.push(agentName);
      } catch (err: unknown) {
        status = "FAILED";
        error = err instanceof Error ? err.message : "Agent execution failed";
        console.error(`❌ [AgentDependencyOrchestrator] Agent ${agentName} failed:`, err);
      } finally {
        const completedAt = new Date();
        const durationMs = Date.now() - startMs;

        // Persist agent execution record durably with complete timing and provenance metadata
        await db.agentExecutionRecord.create({
          data: {
            shipmentId,
            agentName,
            triggerEvent,
            invokedBy: invokedByLabel,
            nextStep,
            status,
            durationMs,
            error,
            startedAt: agentStart,
            completedAt,
          },
        });
      }
    }

    // Always run reconciliation after agent execution to maintain canonical state integrity
    await ReconciliationEngine.reconcileShipment(shipmentId, triggerEvent);

    // Fetch updated canonical shipment state
    const canonicalState = await CanonicalShipmentService.getCanonicalState(shipmentId);

    const totalDuration = Date.now() - startTime;
    console.log(
      `✅ [AgentDependencyOrchestrator] Finished selective execution (${executedAgents.length} agents) in ${totalDuration}ms`
    );

    return {
      shipmentId,
      triggerEvent,
      agentsExecuted: executedAgents,
      durationMs: totalDuration,
      canonicalState,
    };
  }

  /**
   * Maps domain events to affected agents in the dependency graph
   */
  private static determineAgentsToRun(
    triggerEvent: ShipmentEventType,
    payload?: AgentTriggerPayload
  ): string[] {
    switch (triggerEvent) {
      case "DOCUMENT_UPLOADED":
        return [
          "Document Intake Agent",
          "Document Intelligence Agent",
          "HTS Classification Agent",
          "Origin Rules Agent",
          "Valuation & Assists Agent",
          "Compliance Audit Agent",
          "Filing Readiness Agent",
        ];

      case "USER_FIELD_UPDATED": {
        const field = payload?.field;
        if (field === "countryOfOrigin" || field === "origin") {
          return ["Origin Rules Agent", "Compliance Audit Agent", "Filing Readiness Agent"];
        }
        if (field === "htsCode" || field?.startsWith("lineItem")) {
          return [
            "HTS Classification Agent",
            "Origin Rules Agent",
            "Valuation & Assists Agent",
            "Compliance Audit Agent",
            "Filing Readiness Agent",
          ];
        }
        if (field === "incoterm" || field === "totalValue" || field === "currency") {
          return ["Valuation & Assists Agent", "Compliance Audit Agent", "Filing Readiness Agent"];
        }
        // General logistics or identity edit (e.g. ETA, Carrier)
        return ["Compliance Audit Agent", "Filing Readiness Agent"];
      }

      case "RECONCILIATION_REQUESTED":
        return ["Compliance Audit Agent", "Filing Readiness Agent"];

      default:
        return ["Filing Readiness Agent"];
    }
  }

  /**
   * Helper to execute a single agent safely with correct inputs
   */
  private static async runSingleAgent(agentName: string, params: AgentOrchestrationParams) {
    const { shipmentId, accountId, payload } = params;
    const userId = params.userId || "usr_system";

    switch (agentName) {
      case "Document Intake Agent":
        if (payload?.fileUrl && payload.fileName) {
          await DocumentIntakeAgent.execute({
            accountId,
            userId,
            shipmentId,
            fileName: payload.fileName,
            fileUrl: payload.fileUrl,
          });
        }
        break;

      case "Document Intelligence Agent":
        await DocumentIntelligenceAgent.execute({
          accountId,
          userId,
          shipmentId,
          packetId: payload?.documentId || "pkt_default",
        });
        break;

      case "HTS Classification Agent":
        await HTSClassificationAgent.execute({
          accountId,
          userId,
          shipmentId,
          productProfiles: payload?.productProfiles || [],
        });
        break;

      case "Origin Rules Agent":
        await OriginRulesAgent.execute({
          accountId,
          userId,
          shipmentId,
          lineItems: payload?.lineItems || [],
        });
        break;

      case "Valuation & Assists Agent":
        await ValuationAssistsAgent.execute({
          accountId,
          userId,
          shipmentId,
        });
        break;

      case "Compliance Audit Agent":
        await ComplianceAuditAgent.execute({
          accountId,
          userId,
          shipmentId,
        });
        break;

      case "Filing Readiness Agent":
        await FilingReadinessAgent.execute({
          accountId,
          userId,
          shipmentId,
          lineItemCount: payload?.lineItems?.length || 1,
        });
        break;
    }
  }
}
