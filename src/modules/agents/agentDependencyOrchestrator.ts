import { db } from "@/lib/db";
import { ReconciliationEngine } from "@/modules/shipment/reconciliationEngine";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { DocumentIntakeAgent } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent } from "./documentIntelligenceAgent";
import { ProductIntelligenceAgent } from "./productIntelligenceAgent";
import { HTSClassificationAgent } from "./htsClassificationAgent";
import { OriginRulesAgent } from "./originRulesAgent";
import { ValuationAssistsAgent } from "./valuationAssistsAgent";
import { ComplianceAuditAgent } from "./complianceAuditAgent";
import { FilingReadinessAgent } from "./filingReadinessAgent";
import { ShipmentEventBus, ShipmentEventType } from "@/modules/events/shipmentEventBus";

export interface AgentOrchestrationParams {
  shipmentId: string;
  accountId: string;
  userId?: string;
  triggerEvent: ShipmentEventType;
  payload?: any;
}

export interface AgentOrchestrationResult {
  shipmentId: string;
  triggerEvent: ShipmentEventType;
  agentsExecuted: string[];
  durationMs: number;
  canonicalState: any;
}

export class AgentDependencyOrchestrator {
  /**
   * Selective dependency-aware execution engine.
   * Executes ONLY the agents affected by the specific trigger event.
   */
  static async processEvent(params: AgentOrchestrationParams): Promise<AgentOrchestrationResult> {
    const startTime = Date.now();
    const { shipmentId, accountId, triggerEvent, payload } = params;
    // Groups every agent step this call fires into a single invocation for
    // the Agent Executions waterfall view.
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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
      } catch (err: any) {
        status = "FAILED";
        error = err.message || "Agent execution failed";
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
            runId,
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
  private static determineAgentsToRun(triggerEvent: ShipmentEventType, payload?: any): string[] {
    switch (triggerEvent) {
      case "DOCUMENT_UPLOADED":
        // Response & Post-Summary Agent is deliberately excluded here: its
        // own implementation is a placeholder that always returns
        // COMPLETED_NO_ACTION until a real USTR/CBP API is wired up, so
        // re-running it on reattach can never produce a different result --
        // there's nothing to learn by paying for that run.
        //
        // Customs Filing Agent is also deliberately excluded: unlike every
        // other agent here (which only appends an AgentDecision audit row),
        // it CREATES a new CustomsFiling record with a fabricated CBP entry
        // number and status "Accepted"/"Released" whenever the shipment
        // looks ready -- i.e. it simulates actually transmitting and having
        // the entry cleared by customs. Firing that automatically as a side
        // effect of a document reattach, with no user attestation, would
        // fabricate a real-looking "filed and released" record. It must
        // only run from an explicit, authorized filing action.
        return [
          "Document Intake Agent",
          "Document Intelligence Agent",
          "Product Intelligence Agent",
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

    // HTS Classification, Origin Rules, and Product Intelligence all need
    // real line-item data to produce anything meaningful -- previously they
    // silently ran on payload?.lineItems || [] (always empty, since no
    // caller ever populates it), so these three "ran" but recomputed
    // nothing. Fetch the shipment's actual current line items once here so
    // that re-running them on reattach can genuinely change their output.
    const needsLineItems = ["HTS Classification Agent", "Origin Rules Agent", "Product Intelligence Agent"];
    const dbLineItems = needsLineItems.includes(agentName)
      ? await db.shipmentLineItem.findMany({ where: { shipmentId } })
      : [];

    switch (agentName) {
      case "Document Intake Agent":
        if (payload?.fileUrl) {
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

      case "Product Intelligence Agent":
        await ProductIntelligenceAgent.execute({
          accountId,
          userId,
          shipmentId,
          lineItems:
            payload?.lineItems ||
            dbLineItems.map((li) => ({
              lineNumber: li.lineNumber,
              sku: li.partNumber || undefined,
              description: li.description,
            })),
        });
        break;

      case "HTS Classification Agent":
        await HTSClassificationAgent.execute({
          accountId,
          userId,
          shipmentId,
          productProfiles:
            payload?.productProfiles ||
            dbLineItems.map((li) => ({
              lineNumber: li.lineNumber,
              rawDescription: li.description,
            })),
        });
        break;

      case "Origin Rules Agent":
        await OriginRulesAgent.execute({
          accountId,
          userId,
          shipmentId,
          lineItems:
            payload?.lineItems ||
            dbLineItems.map((li) => ({
              lineNumber: li.lineNumber,
              htsCode: li.htsCode,
              manufacturingCountry: li.countryOfOrigin,
            })),
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
