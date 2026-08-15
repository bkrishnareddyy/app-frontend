import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/audit";
import { DocumentIntakeAgent } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent, DocumentIntelligenceOutput } from "./documentIntelligenceAgent";
import { ProductIntelligenceAgent, ProductIntelligenceOutput } from "./productIntelligenceAgent";
import { HTSClassificationAgent, HTSClassificationOutput } from "./htsClassificationAgent";
import { OriginRulesAgent, OriginRulesOutput } from "./originRulesAgent";
import { ValuationAssistsAgent, ValuationAssistsOutput } from "./valuationAssistsAgent";
import { ComplianceAuditAgent, ComplianceAuditOutput } from "./complianceAuditAgent";
import { FilingReadinessAgent } from "./filingReadinessAgent";
import { ReconciliationEngine } from "@/modules/shipment/reconciliationEngine";
import { CanonicalShipmentService } from "@/modules/shipment/canonicalShipmentService";
import { ShipmentEventBus, ShipmentEventType } from "@/modules/events/shipmentEventBus";
import { FactService, RecordFactInput } from "@/modules/shipment/factService";
import { LineItemReconciler, lineItemFactField } from "@/modules/shipment/lineItemReconciler";
import { buildAgentContext, ShipmentAgentContext, factValue, latestTradeMetadata } from "./agentContext";
import { computeFilingTariff, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { captureShipmentOutputFacts } from "./outputCapture";
import { PgQueue } from "@/lib/queue/pgQueue";

/**
 * Replaces ComplianceWorkflowEngine/AgentOrchestrator (the fixed 10-step
 * pipeline that used to run on upload, threaded through an in-memory
 * AgentState) and AgentDependencyOrchestrator (the selective dependency-graph
 * runner used on field edits/reattach/reconcile). Every trigger now goes
 * through this one entry point, every agent's input is built fresh from
 * Postgres (buildAgentContext), and every agent's output is persisted the
 * same way regardless of what triggered the run.
 */
export interface AgentTriggerPayload {
  field?: string;
  newValue?: string | null;
  documentId?: string;
  fileName?: string;
  fileUrl?: string;
  fileBuffer?: Buffer;
  mimeType?: string;
  docTypeOverride?: string;
  entryType?: string;
  [key: string]: unknown;
}

export interface ProcessEventParams {
  shipmentId: string;
  accountId: string;
  userId?: string;
  triggerEvent: ShipmentEventType;
  payload?: AgentTriggerPayload;
  /** PipelineJob to report step progress against, for callers running this inline behind a job record. */
  jobId?: string;
}

export interface ProcessEventResult {
  shipmentId: string;
  triggerEvent: ShipmentEventType;
  agentsExecuted: string[];
  durationMs: number;
  canonicalState: Awaited<ReturnType<typeof CanonicalShipmentService.getCanonicalState>>;
}

interface SingleAgentResult {
  confidence?: unknown;
  decisionId?: string | null;
  aiProviderUsed?: string;
  summary?: string;
  input: unknown;
  output: unknown;
}

/** Carried across the agents fired within one processEvent call only -- not persisted, not a source of truth. Postgres is. */
interface RunScratch {
  packetId?: string;
  isComplianceBlocked?: boolean;
}

function numOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function computeDutyDue(context: ShipmentAgentContext): Promise<number | null> {
  const classified = context.lineItems.filter((li) => li.htsCode && li.htsCode !== "UNCLASSIFIABLE");
  if (classified.length === 0) return null;
  const lineItems = classified.map((li) => ({ htsCode: li.htsCode, totalValue: new Prisma.Decimal(li.totalValue) }));
  const tariff = computeFilingTariff(lineItems, await loadHtsCodesMap(lineItems));
  return tariff.unratedLineCount > 0 ? null : tariff.totalDuty;
}

/** Facts that don't correspond to a ShipmentLineItem column (enrichment detail, origin/valuation results) still get recorded -- nothing an agent discovers is dropped just because there's no curated-record column for it. */
async function recordLineItemFacts(
  shipmentId: string,
  documentId: string | null,
  sourceType: "EXTRACTED" | "AGENT_PROPOSED",
  lineNumber: number,
  fields: Record<string, string | number | null | undefined>
): Promise<void> {
  const facts: RecordFactInput[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "") continue;
    facts.push({
      shipmentId,
      field: lineItemFactField(lineNumber, field),
      value: String(value),
      sourceType,
      documentId,
    });
  }
  await FactService.recordMany(facts);
}

export class PipelineOrchestrator {
  static async processEvent(params: ProcessEventParams): Promise<ProcessEventResult> {
    const startTime = Date.now();
    const { shipmentId, accountId, triggerEvent, payload, jobId } = params;
    const userId = params.userId || "usr_system";
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const invokedByLabel = this.invokedByLabel(triggerEvent, payload);

    await ShipmentEventBus.logEvent({
      shipmentId,
      eventType: triggerEvent,
      payload,
      triggeredBy: params.userId || "SYSTEM",
    });

    const agentsToRun = this.determineAgentsToRun(triggerEvent, payload);
    const executedAgents: string[] = [];
    const scratch: RunScratch = {};

    for (let i = 0; i < agentsToRun.length; i++) {
      const agentName = agentsToRun[i];
      const nextStep = i < agentsToRun.length - 1 ? agentsToRun[i + 1] : "Reconciliation";
      const stepStart = Date.now();
      const startedAt = new Date();

      let status: "COMPLETED" | "FAILED" = "COMPLETED";
      let error: string | undefined;
      let confidence: unknown = null;
      let decisionId: string | null = null;
      let aiProviderUsed: string | undefined;
      let summary: string | undefined;
      let inputSnapshot: unknown = null;
      let outputSnapshot: unknown = null;

      try {
        const result = await this.runSingleAgent(agentName, {
          shipmentId,
          accountId,
          userId,
          documentId: payload?.documentId ?? null,
          payload,
          scratch,
        });
        executedAgents.push(agentName);
        confidence = result.confidence ?? null;
        decisionId = result.decisionId ?? null;
        aiProviderUsed = result.aiProviderUsed;
        summary = result.summary;
        inputSnapshot = result.input;
        outputSnapshot = result.output;
      } catch (err) {
        status = "FAILED";
        error = err instanceof Error ? err.message : "Agent execution failed";
        console.error(`[PipelineOrchestrator] ${agentName} failed:`, err);
      } finally {
        await db.agentExecutionRecord
          .create({
            data: {
              accountId,
              shipmentId,
              agentName,
              triggerEvent,
              invokedBy: invokedByLabel,
              stepNumber: i + 1,
              nextStep,
              summary,
              status,
              durationMs: Date.now() - stepStart,
              confidence: (confidence ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              decisionId,
              aiProviderUsed,
              startedAt,
              completedAt: new Date(),
              runId,
              error,
              inputSnapshot: (inputSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              outputSnapshot: (outputSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            },
          })
          .catch((e) => console.error("[PipelineOrchestrator] Failed to write execution record:", e));

        if (jobId) {
          await PgQueue.updateProgress(jobId, i + 1).catch((e) =>
            console.error("[PipelineOrchestrator] Failed to update job progress:", e)
          );
        }
      }
    }

    // Unconditional, regardless of trigger -- this is what turns current DB
    // state into human-visible ExceptionItem action items. The old upload
    // path never called this at all; every trigger does now.
    await ReconciliationEngine.reconcileShipment(shipmentId, accountId, triggerEvent);

    const canonicalState = await CanonicalShipmentService.getCanonicalState(shipmentId);

    return {
      shipmentId,
      triggerEvent,
      agentsExecuted: executedAgents,
      durationMs: Date.now() - startTime,
      canonicalState,
    };
  }

  private static invokedByLabel(triggerEvent: ShipmentEventType, payload?: AgentTriggerPayload): string {
    if (triggerEvent === "USER_FIELD_UPDATED") return `User (${payload?.field ? `Edit ${payload.field}` : "Manual Edit"})`;
    if (triggerEvent === "DOCUMENT_UPLOADED") return "Document Upload Intake";
    return "Reconciliation Engine";
  }

  /**
   * Maps a domain event to the agents it affects. Response & Post-Summary and
   * Customs Filing are deliberately excluded from every auto-triggered path:
   * Response's own implementation is a placeholder with nothing new to learn
   * from a re-run, and Customs Filing simulates an actual CBP transmission --
   * firing it as a side effect of an edit or reattach, with no user
   * attestation, would fabricate a real-looking "filed and released" record.
   * Both only ever run from the explicit, authorized filing action at
   * /api/agents/[agentId], never from here.
   */
  private static determineAgentsToRun(triggerEvent: ShipmentEventType, payload?: AgentTriggerPayload): string[] {
    switch (triggerEvent) {
      case "DOCUMENT_UPLOADED":
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
        if (field === "htsCode") {
          return [
            "HTS Classification Agent",
            "Origin Rules Agent",
            "Valuation & Assists Agent",
            "Compliance Audit Agent",
            "Filing Readiness Agent",
          ];
        }
        // A lineItem* edit (material, manufacturer, composition, model, MPN,
        // SKU, GTIN, countryOfManufacture, description, ...) changes the facts
        // Product Intelligence enriches, so it must rerun and refresh those
        // facts before HTS Classification reads them again -- otherwise HTS
        // classifies against a stale product picture.
        if (field?.startsWith("lineItem")) {
          return [
            "Product Intelligence Agent",
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
        return ["Compliance Audit Agent", "Filing Readiness Agent"];
      }

      case "RECONCILIATION_REQUESTED":
        return ["Compliance Audit Agent", "Filing Readiness Agent"];

      default:
        return ["Filing Readiness Agent"];
    }
  }

  private static async runSingleAgent(
    agentName: string,
    ctx: {
      shipmentId: string;
      accountId: string;
      userId: string;
      documentId: string | null;
      payload?: AgentTriggerPayload;
      scratch: RunScratch;
    }
  ): Promise<SingleAgentResult> {
    const { shipmentId, accountId, userId, documentId, payload, scratch } = ctx;

    switch (agentName) {
      case "Document Intake Agent": {
        if (!payload?.fileUrl || !payload.fileName) {
          return { input: null, output: { skipped: "No file on this trigger" } };
        }
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          fileName: payload.fileName,
          fileUrl: payload.fileUrl,
          fileBuffer: payload.fileBuffer,
          mimeType: payload.mimeType,
          docTypeOverride: payload.docTypeOverride,
        };
        const output = await DocumentIntakeAgent.execute(agentInput);
        scratch.packetId = output.packetId;
        await captureShipmentOutputFacts({
          shipmentId,
          documentId,
          agentKey: "documentIntake",
          output: output as unknown as Record<string, unknown>,
          exclude: ["shipmentDocumentId", "packetId"],
        });
        const detectedType = output.detectedTypes?.[0];
        const intakeSummary = [
          detectedType && `${detectedType.replace(/_/g, " ")}`,
          output.pageCount != null && `${output.pageCount}p`,
          output.documentCount != null && output.documentCount > 1 && `${output.documentCount} docs`,
        ]
          .filter(Boolean)
          .join(", ");
        return { decisionId: output.agentDecisionId, aiProviderUsed: output.aiProviderUsed, summary: intakeSummary || undefined, input: agentInput, output };
      }

      case "Document Intelligence Agent": {
        const packetId = scratch.packetId || documentId || "pkt_default";
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          packetId,
          fileBuffer: payload?.fileBuffer,
          fileName: payload?.fileName,
          mimeType: payload?.mimeType,
        };
        const output = await DocumentIntelligenceAgent.execute(agentInput);
        await this.persistIntelligence(shipmentId, accountId, documentId, output);
        await captureShipmentOutputFacts({
          shipmentId,
          documentId,
          agentKey: "documentIntelligence",
          output: output as unknown as Record<string, unknown>,
          exclude: [
            "exporterName",
            "importerName",
            "originCountry",
            "destinationCountry",
            "incoterm",
            "currency",
            "invoiceSubtotal",
            "invoiceNumber",
            "invoiceDate",
            "lineItems",
            "rawDiscoveredKeyValues",
            "packetId",
          ],
        });
        const lineCount = output.lineItems?.length ?? 0;
        const exporter = output.exporterName || output.importerName;
        const intelliSummary = [
          lineCount > 0 && `${lineCount} line item${lineCount !== 1 ? "s" : ""}`,
          exporter && `from ${exporter}`,
          output.invoiceNumber && `inv ${output.invoiceNumber}`,
        ]
          .filter(Boolean)
          .join("; ");
        return {
          decisionId: output.agentDecisionId,
          aiProviderUsed: output.aiProviderUsed,
          confidence: output.confidenceMetrics,
          summary: intelliSummary || undefined,
          input: agentInput,
          output,
        };
      }

      case "Product Intelligence Agent": {
        const context = await buildAgentContext(shipmentId);
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          lineItems: context.lineItems.map((li) => ({
            lineNumber: li.lineNumber,
            sku: li.partNumber ?? undefined,
            description: li.description,
            countryOfOrigin: li.countryOfOrigin !== "Unknown" ? li.countryOfOrigin : factValue(context, "countryOfOrigin"),
            // Not yet populated by any extraction stage today -- read from
            // per-line facts so this agent picks them up automatically once a
            // future document-extraction upgrade starts writing them, with no
            // further pipeline wiring required.
            supplierSku: context.facts[lineItemFactField(li.lineNumber, "supplierSku")]?.value ?? null,
            manufacturerPartNumber: context.facts[lineItemFactField(li.lineNumber, "manufacturerPartNumber")]?.value ?? null,
            model: context.facts[lineItemFactField(li.lineNumber, "model")]?.value ?? null,
            gtin: context.facts[lineItemFactField(li.lineNumber, "gtin")]?.value ?? null,
            manufacturerName: context.facts[lineItemFactField(li.lineNumber, "manufacturerName")]?.value ?? null,
            supplierName: context.facts[lineItemFactField(li.lineNumber, "supplierName")]?.value ?? null,
            brandOwnerName: context.facts[lineItemFactField(li.lineNumber, "brandOwnerName")]?.value ?? null,
            countryOfManufacture: context.facts[lineItemFactField(li.lineNumber, "countryOfManufacture")]?.value ?? null,
          })),
        };
        const output = await ProductIntelligenceAgent.execute(agentInput);
        await this.persistProductIntelligence(shipmentId, accountId, userId, documentId, agentInput.lineItems, output);
        const productCount = output.profiles?.length ?? 0;
        const productSummary = productCount > 0 ? `Enriched ${productCount} product profile${productCount !== 1 ? "s" : ""}` : undefined;
        return { decisionId: output.agentDecisionId, aiProviderUsed: output.aiProviderUsed, confidence: output.confidence, summary: productSummary, input: agentInput, output };
      }

      case "HTS Classification Agent": {
        const context = await buildAgentContext(shipmentId);
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          productProfiles: context.lineItems.map((li) => ({
            lineNumber: li.lineNumber,
            rawDescription: li.description,
            enrichedDescription: context.facts[lineItemFactField(li.lineNumber, "enrichedDescription")]?.value,
            essentialCharacter: context.facts[lineItemFactField(li.lineNumber, "essentialCharacter")]?.value,
            materialComposition: context.facts[lineItemFactField(li.lineNumber, "materialComposition")]?.value ?? null,
            endUse: context.facts[lineItemFactField(li.lineNumber, "endUse")]?.value ?? null,
            finish: context.facts[lineItemFactField(li.lineNumber, "finish")]?.value ?? null,
            carbonContentPercentage: numOrNull(context.facts[lineItemFactField(li.lineNumber, "carbonContentPercentage")]?.value),
            casNumber: context.facts[lineItemFactField(li.lineNumber, "casNumber")]?.value ?? null,
          })),
          countryOfOrigin: factValue(context, "countryOfOrigin"),
        };
        const output: HTSClassificationOutput = await HTSClassificationAgent.execute(agentInput);
        await this.persistClassification(shipmentId, accountId, documentId, output);
        const classifiedCount = output.classifications?.filter((c: { htsCode: string }) => c.htsCode !== "UNCLASSIFIABLE").length ?? 0;
        const totalClassified = output.classifications?.length ?? 0;
        const htsSummary = totalClassified > 0
          ? `${classifiedCount}/${totalClassified} classified${output.overallConfidence != null ? `; ${Math.round(Number(output.overallConfidence))}% confidence` : ""}`
          : undefined;
        return {
          decisionId: output.agentDecisionId,
          aiProviderUsed: output.aiProviderUsed,
          confidence: output.overallConfidence,
          summary: htsSummary,
          input: agentInput,
          output,
        };
      }

      case "Origin Rules Agent": {
        const context = await buildAgentContext(shipmentId);
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          lineItems: context.lineItems.map((li) => ({
            lineNumber: li.lineNumber,
            htsCode: li.htsCode !== "UNCLASSIFIABLE" ? li.htsCode : null,
            manufacturingCountry: li.countryOfOrigin !== "Unknown" ? li.countryOfOrigin : factValue(context, "countryOfOrigin"),
            rawMaterialOrigin: context.facts[lineItemFactField(li.lineNumber, "rawMaterialOrigin")]?.value,
            standardDutyRate: context.facts[lineItemFactField(li.lineNumber, "dutyRate")]?.value,
            description: li.description,
            sku: li.partNumber,
            materialComposition: context.facts[lineItemFactField(li.lineNumber, "materialComposition")]?.value ?? null,
            essentialCharacter: context.facts[lineItemFactField(li.lineNumber, "essentialCharacter")]?.value ?? null,
            endUse: context.facts[lineItemFactField(li.lineNumber, "endUse")]?.value ?? null,
          })),
        };
        const output: OriginRulesOutput = await OriginRulesAgent.execute(agentInput);
        for (const q of output.qualifications) {
          await recordLineItemFacts(shipmentId, documentId, "AGENT_PROPOSED", q.lineNumber, {
            ftaProgram: q.ftaProgram,
            spiCode: q.spiCode,
            preferenceCriterion: q.preferenceCriterion,
            tariffShiftMet: q.tariffShiftMet == null ? null : String(q.tariffShiftMet),
            estimatedSavings: q.estimatedSavings,
            standardDutyRate: q.standardDutyRate,
            ftaDutyRate: q.ftaDutyRate,
            countryOfOrigin: q.countryOfOrigin,
          });
        }
        const qualCount = output.qualifications?.length ?? 0;
        const savings = (output.qualifications ?? []).reduce((s: number, q: { estimatedSavings?: number | null }) => s + (q.estimatedSavings ?? 0), 0);
        const originSummary = qualCount > 0
          ? `${qualCount} FTA qualification${qualCount !== 1 ? "s" : ""}${savings > 0 ? `; est. $${savings.toLocaleString()} savings` : ""}`
          : "No FTA qualifications found";
        return { decisionId: output.agentDecisionId, aiProviderUsed: output.aiProviderUsed, confidence: output.confidence, summary: originSummary, input: agentInput, output };
      }

      case "Valuation & Assists Agent": {
        const context = await buildAgentContext(shipmentId);
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          invoiceSubtotal: numOrNull(factValue(context, "invoiceSubtotal")),
          oceanFreight: numOrNull(factValue(context, "oceanFreight")) ?? undefined,
          buyerAssists: numOrNull(factValue(context, "buyerAssists")) ?? undefined,
          lineItems: context.lineItems.map((li) => ({
            lineNumber: li.lineNumber,
            totalValue: li.totalValue,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
          })),
        };
        const output: ValuationAssistsOutput = await ValuationAssistsAgent.execute(agentInput);
        if (output.enteredCustomsValue != null) {
          await FactService.record({
            shipmentId,
            field: "enteredCustomsValue",
            value: String(output.enteredCustomsValue),
            sourceType: "AGENT_PROPOSED",
            documentId,
          });
        }
        await captureShipmentOutputFacts({
          shipmentId,
          documentId,
          agentKey: "valuationAssists",
          output: output as unknown as Record<string, unknown>,
          exclude: ["enteredCustomsValue", "shipmentId"],
        });
        const ecv = output.enteredCustomsValue;
        const valuationSummary = ecv != null ? `Entered customs value $${Number(ecv).toLocaleString()}` : "No customs value determined";
        return { decisionId: output.agentDecisionId, aiProviderUsed: output.aiProviderUsed, confidence: output.confidence, summary: valuationSummary, input: agentInput, output };
      }

      case "Compliance Audit Agent": {
        const context = await buildAgentContext(shipmentId);
        const isHtsBlocked = context.lineItems.length === 0 || context.lineItems.every((li) => li.htsCode === "UNCLASSIFIABLE");
        const logistics = latestTradeMetadata(context);
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          lineItems: context.lineItems.map((li) => ({
            lineNumber: li.lineNumber,
            htsCode: li.htsCode !== "UNCLASSIFIABLE" ? li.htsCode : null,
            countryOfOrigin: li.countryOfOrigin !== "Unknown" ? li.countryOfOrigin : factValue(context, "countryOfOrigin"),
            description: li.description,
            sku: li.partNumber,
            totalValue: li.totalValue,
            eccn: li.eccnCode,
          })),
          destinationCountry: factValue(context, "destinationCountry"),
          shipFromCountry: context.countryOfExport,
          importerName: factValue(context, "importerName"),
          incoterm: factValue(context, "incoterm"),
          exporterName: factValue(context, "exporterName"),
          supplierName: factValue(context, "exporterName") ?? undefined,
          portOfLoading: strOrNull(logistics?.portOfLoading),
          portOfDischarge: strOrNull(logistics?.portOfDischarge),
          carrier: strOrNull(logistics?.carrier),
          transportDocumentNumber: strOrNull(logistics?.transportDocumentNumber),
          isHtsBlocked,
          parties: context.parties,
        };
        const output: ComplianceAuditOutput = await ComplianceAuditAgent.execute(agentInput);
        scratch.isComplianceBlocked = output.status === "BLOCKED_DEPENDENCY";
        await captureShipmentOutputFacts({
          shipmentId,
          documentId,
          agentKey: "complianceAudit",
          output: output as unknown as Record<string, unknown>,
          exclude: ["auditResults", "flags"],
        });
        const findingsByLine = new Map<number, typeof output.auditResults>();
        for (const result of output.auditResults) {
          if (result.lineNumber == null) continue;
          const existing = findingsByLine.get(result.lineNumber) ?? [];
          existing.push(result);
          findingsByLine.set(result.lineNumber, existing);
        }
        for (const [lineNumber, findings] of findingsByLine) {
          await recordLineItemFacts(shipmentId, documentId, "AGENT_PROPOSED", lineNumber, {
            complianceFindings: JSON.stringify(findings),
          });
        }
        const issueCount = output.auditResults?.filter((r: { severity?: string }) => r.severity === "HIGH" || r.severity === "MEDIUM").length ?? 0;
        const totalIssues = output.auditResults?.length ?? 0;
        const complianceSummary = output.status === "BLOCKED_DEPENDENCY"
          ? "Blocked — missing upstream data"
          : totalIssues === 0
          ? "Cleared — no findings"
          : `${totalIssues} finding${totalIssues !== 1 ? "s" : ""}${issueCount > 0 ? ` (${issueCount} high/med)` : ""}`;
        return { decisionId: output.agentDecisionId, aiProviderUsed: output.aiProviderUsed, confidence: null, summary: complianceSummary, input: agentInput, output };
      }

      case "Filing Readiness Agent": {
        const context = await buildAgentContext(shipmentId);
        const isHtsBlocked = context.lineItems.length === 0 || context.lineItems.every((li) => li.htsCode === "UNCLASSIFIABLE");
        const isOriginBlocked = !factValue(context, "countryOfOrigin");
        const logistics = latestTradeMetadata(context);
        const agentInput = {
          accountId,
          userId,
          shipmentId,
          documentId,
          enteredValue: numOrNull(factValue(context, "enteredCustomsValue")),
          dutyDue: await computeDutyDue(context),
          lineItemCount: context.lineItems.length,
          hasCommercialInvoice: Boolean(factValue(context, "invoiceSubtotal")),
          isHtsBlocked,
          isOriginBlocked,
          isComplianceBlocked: scratch.isComplianceBlocked ?? false,
          entryType: payload?.entryType,
          portOfLoading: strOrNull(logistics?.portOfLoading),
          portOfDischarge: strOrNull(logistics?.portOfDischarge),
          carrier: strOrNull(logistics?.carrier),
          transportDocumentNumber: strOrNull(logistics?.transportDocumentNumber),
        };
        const output = await FilingReadinessAgent.execute(agentInput);
        await captureShipmentOutputFacts({
          shipmentId,
          documentId,
          agentKey: "filingReadiness",
          output: output as unknown as Record<string, unknown>,
        });
        const readinessSummary = output.readinessScore != null
          ? `Readiness score ${Math.round(Number(output.readinessScore))}%${output.status ? ` — ${output.status}` : ""}`
          : undefined;
        return { decisionId: output.agentDecisionId, aiProviderUsed: output.aiProviderUsed, confidence: output.readinessScore, summary: readinessSummary, input: agentInput, output };
      }

      default:
        throw new Error(`Unknown agent: ${agentName}`);
    }
  }

  private static async persistIntelligence(
    shipmentId: string,
    accountId: string,
    documentId: string | null,
    output: DocumentIntelligenceOutput
  ): Promise<void> {
    const shipmentFacts: RecordFactInput[] = [];
    const push = (field: string, value: string | number | null | undefined) => {
      if (value === null || value === undefined || value === "") return;
      shipmentFacts.push({ shipmentId, field, value: String(value), sourceType: "EXTRACTED", documentId });
    };
    push("exporterName", output.exporterName);
    push("importerName", output.importerName);
    push("countryOfOrigin", output.originCountry);
    push("destinationCountry", output.destinationCountry);
    push("incoterm", output.incoterm);
    push("currency", output.currency);
    push("invoiceSubtotal", output.invoiceSubtotal);
    push("invoiceNumber", output.invoiceNumber);
    push("invoiceDate", output.invoiceDate);
    await FactService.recordMany(shipmentFacts);

    await LineItemReconciler.applyDiscoveries({
      shipmentId,
      accountId,
      documentId,
      sourceType: "EXTRACTED",
      items: output.lineItems.map((li) => ({
        lineNumber: li.lineNumber,
        description: li.description,
        partNumber: li.sku ?? null,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        totalValue: li.totalAmount,
        countryOfOrigin: li.countryOfOrigin ?? output.originCountry ?? null,
        htsCode: li.htsCode,
      })),
    });

    await LineItemReconciler.fillShipmentFields(shipmentId, accountId, {
      countryOfOrigin: output.originCountry,
      incoterm: output.incoterm,
    });
  }

  private static async persistProductIntelligence(
    shipmentId: string,
    accountId: string,
    userId: string,
    documentId: string | null,
    lineItems: Array<{ lineNumber: number }>,
    output: ProductIntelligenceOutput
  ): Promise<void> {
    // profiles[] is produced in the same order as the lineItems it was given -- see ProductIntelligenceAgent.execute's `for (const item of input.lineItems)` loop.
    for (let i = 0; i < output.profiles.length; i++) {
      const lineNumber = lineItems[i]?.lineNumber;
      if (lineNumber == null) continue;
      const profile = output.profiles[i];
      await recordLineItemFacts(shipmentId, documentId, "AGENT_PROPOSED", lineNumber, {
        enrichedDescription: profile.enrichedDescription,
        materialComposition: profile.materialComposition,
        essentialCharacter: profile.essentialCharacter,
        carbonContentPercentage: profile.carbonContentPercentage,
        finish: profile.finish,
        casNumber: profile.casNumber,
        endUse: profile.endUse,
        confidence: profile.confidence,
        // Additive facts from the Product Master upgrade -- HTS Classification
        // does not read these, so adding them cannot change its behavior.
        productMatchStatus: profile.productMatch,
        existingProductId: profile.existingProductId,
        verificationStatus: profile.verificationStatus,
        productIdentityReadiness: profile.readiness.productIdentity,
        classificationReadiness: profile.readiness.classification,
        originReadiness: profile.readiness.origin,
        regulatoryReadiness: profile.readiness.regulatory,
        valuationReadiness: profile.readiness.valuation,
        recommendedActions: profile.recommendedActions.length
          ? JSON.stringify(profile.recommendedActions.map((a) => a.flag))
          : null,
      });

      await this.auditProductIntelligenceFindings(shipmentId, accountId, userId, lineNumber, profile);
      await this.raiseProductIntelligenceExceptions(shipmentId, accountId, documentId, lineNumber, profile);
    }
  }

  /**
   * Audit trail for what this agent decided per line item, distinct from the
   * single AGENT_EXECUTION_COMPLETED entry the agent itself already writes --
   * these are per-finding entries (match outcome, each conflict/change/gap)
   * so the audit log names the specific thing that happened, not just that
   * the agent ran.
   */
  private static async auditProductIntelligenceFindings(
    shipmentId: string,
    accountId: string,
    userId: string,
    lineNumber: number,
    profile: ProductIntelligenceOutput["profiles"][number]
  ): Promise<void> {
    const entries: Array<{ action: string; metadata: Record<string, unknown> }> = [];

    entries.push({
      action: profile.productMatch === "NO_MATCH" ? "PRODUCT_INTELLIGENCE_NO_MATCH" : "PRODUCT_INTELLIGENCE_MATCHED",
      metadata: { lineNumber, matchStatus: profile.productMatch, existingProductId: profile.existingProductId },
    });
    for (const conflict of profile.conflicts) {
      entries.push({
        action: "PRODUCT_INTELLIGENCE_CONFLICT",
        metadata: { lineNumber, conflictType: conflict.type, field: conflict.field },
      });
    }
    for (const change of profile.changes) {
      entries.push({ action: "PRODUCT_INTELLIGENCE_CHANGE_DETECTED", metadata: { lineNumber, field: change.field } });
    }
    if (profile.missingInformation.length > 0) {
      entries.push({
        action: "PRODUCT_INTELLIGENCE_MISSING_DATA",
        metadata: { lineNumber, fields: profile.missingInformation.map((m) => m.field) },
      });
    }
    for (const rec of profile.recommendedActions) {
      entries.push({ action: "PRODUCT_INTELLIGENCE_REVALIDATION_REQUESTED", metadata: { lineNumber, flag: rec.flag } });
    }
    if (profile.newProductCandidate) {
      entries.push({ action: "PRODUCT_INTELLIGENCE_PROPOSAL_CREATED", metadata: { lineNumber } });
    }

    for (const entry of entries) {
      try {
        await createAuditLog({
          accountId,
          userId,
          action: entry.action,
          entity: "SHIPMENT",
          entityId: shipmentId,
          source: "SYSTEM",
          metadata: { agentName: "Product Intelligence Agent", ...entry.metadata },
        });
      } catch {
        // Audit logging failures must not block the pipeline; the agent's own
        // AGENT_EXECUTION_COMPLETED entry already records that this ran.
      }
    }
  }

  /**
   * Surfaces conflicts and customs-significant changes as ExceptionItems --
   * review-routing only, exactly as every other non-blocking finding in this
   * pipeline is surfaced. Never mutates the Product Master and never resolves
   * anything on its own; a conflict or change stays open until a person acts.
   */
  private static async raiseProductIntelligenceExceptions(
    shipmentId: string,
    accountId: string,
    documentId: string | null,
    lineNumber: number,
    profile: ProductIntelligenceOutput["profiles"][number]
  ): Promise<void> {
    const findings: Array<{ code: string; category: string; description: string }> = [];

    for (const conflict of profile.conflicts) {
      findings.push({
        code: `PRODUCT_${conflict.type}_LINE_${lineNumber}_${conflict.field}`,
        category: "CONFLICT",
        description: `Line ${lineNumber}: ${conflict.explanation} (incoming: "${conflict.incomingValue}", Product Master: "${conflict.masterValue}")`,
      });
    }

    for (const action of profile.recommendedActions) {
      findings.push({
        code: `PRODUCT_${action.flag}_LINE_${lineNumber}`,
        category: "CLASSIFICATION",
        description: `Line ${lineNumber}: ${action.reason}`,
      });
    }

    for (const finding of findings) {
      const existing = await db.exceptionItem.findFirst({
        where: { shipmentId, accountId, code: finding.code, status: { not: "Resolved" } },
      });
      if (existing) continue;

      await db.exceptionItem.create({
        data: {
          accountId,
          shipmentId,
          documentId,
          code: finding.code,
          category: finding.category,
          type: "data_mismatch",
          severity: "Medium",
          description: finding.description,
          blocking: false,
          sourceAgent: "Product Intelligence Agent",
          status: "Open",
        },
      });
    }
  }

  private static async persistClassification(
    shipmentId: string,
    accountId: string,
    documentId: string | null,
    output: HTSClassificationOutput
  ): Promise<void> {
    for (const c of output.classifications) {
      await recordLineItemFacts(shipmentId, documentId, "AGENT_PROPOSED", c.lineNumber, {
        htsDescription: c.htsDescription,
        dutyRate: c.dutyRate,
        legalRationale: c.legalRationale,
        griCitations: c.griCitations?.length ? JSON.stringify(c.griCitations) : null,
        crossRulings: c.crossRulings?.length ? JSON.stringify(c.crossRulings) : null,
        evaluatorScore: c.evaluatorScore,
        evaluatorCritique: c.evaluatorCritique,
        refinementTurns: c.refinementTurns,
      });
    }
    await LineItemReconciler.applyDiscoveries({
      shipmentId,
      accountId,
      documentId,
      sourceType: "AGENT_PROPOSED",
      items: output.classifications.map((c) => ({
        lineNumber: c.lineNumber,
        htsCode: c.htsCode !== "UNCLASSIFIABLE" ? c.htsCode : null,
        htsConfidence: c.confidence,
      })),
    });
  }
}
