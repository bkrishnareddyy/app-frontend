import { DocumentIntakeAgent, DocumentIntakeAgentOutput } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent, DocumentIntelligenceOutput, LineItemExtraction } from "./documentIntelligenceAgent";
import { ProductIntelligenceAgent, ProductIntelligenceOutput, EnrichedProductProfile } from "./productIntelligenceAgent";
import { HTSClassificationAgent, HTSClassificationOutput, ClassificationResultItem } from "./htsClassificationAgent";
import { OriginRulesAgent, OriginRulesOutput } from "./originRulesAgent";
import { ValuationAssistsAgent, ValuationAssistsOutput } from "./valuationAssistsAgent";
import { ComplianceAuditAgent, ComplianceAuditOutput } from "./complianceAuditAgent";
import { FilingReadinessAgent, FilingReadinessOutput } from "./filingReadinessAgent";
import { CustomsFilingAgent, CustomsFilingOutput } from "./customsFilingAgent";
import { ResponseManagementAgent, ResponseManagementOutput } from "./responseManagementAgent";
import { AgentState, CanonicalShipmentState } from "./agentState";
import {
  ComplianceAgent,
  AgentResult,
  BlockerDetail,
  HumanReviewTask,
  RequiredFieldRequirement,
} from "./complianceAgent";

export interface PipelineOrchestrationInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  fileName?: string;
  fileUrl?: string;
  fileBuffer?: Buffer;
  mimeType?: string;
  docTypeOverride?: string;
  // Human label + machine trigger code recorded on every AgentExecutionLog
  // row this run produces, for the Agent Executions waterfall view.
  triggerEvent?: string;
  invokedBy?: string;
}

export interface PipelineOrchestrationOutput {
  shipmentId: string;
  packetId: string;
  status: "COMPLETED" | "BLOCKED" | "REVIEW_REQUIRED";
  lifecycleStatus: "COMPLETED" | "BLOCKED" | "REVIEW_REQUIRED";
  userActionStatus: "ACTION_REQUIRED" | "NONE";
  pipelineStatus: "Completed" | "Review Required";
  canonicalShipmentState: CanonicalShipmentState;
  blockingReasonCodes: string[];
  readiness: {
    score: number;
    readyForTransmission: boolean;
    blockers: BlockerDetail[];
  };
  extractedData: {
    exporter: string | null;
    importer: string | null;
    originCountry: string | null;
    hasCommercialInvoice: boolean;
    invoiceSubtotal: number | null;
    currency: string | null;
    lineItemsCount: number;
    isValidCommercialInvoice: boolean;
    validationFailures: string[];
  };
  agentsSummary: {
    total: number;
    completed: number;
    blocked: number;
    skipped: number;
  };
  humanActions: string[];
  humanReviewTask: HumanReviewTask | null;
  auditTrailUrl: string;
  totalAgentsExecuted: number;
  stateHistoryCount: number;
  mathValidationPassed: boolean;
  mathDiscrepancies: string[];
  evaluatorRefinementsCount: number;
  agentResults: {
    agent1_intake: DocumentIntakeAgentOutput;
    agent2_intelligence: DocumentIntelligenceOutput;
    agent3_product: ProductIntelligenceOutput;
    agent4_classification: HTSClassificationOutput;
    agent5_origin: OriginRulesOutput;
    agent6_valuation: ValuationAssistsOutput;
    agent7_compliance: ComplianceAuditOutput;
    agent8_readiness: FilingReadinessOutput;
    agent9_filing: CustomsFilingOutput;
    agent10_response: ResponseManagementOutput;
  };
}

// -----------------------------------------------------------------------------
// MODULAR COMPLIANCE AGENT WRAPPERS (Agents 1 through 10)
// -----------------------------------------------------------------------------

export class DocumentIntakeStep implements ComplianceAgent<PipelineOrchestrationInput, DocumentIntakeAgentOutput> {
  readonly name = "Document Intake Agent";
  readonly stepNumber = 1;

  canExecute(): boolean {
    return true;
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<DocumentIntakeAgentOutput>> {
    const fileName = input.fileName || "uploaded-trade-document.pdf";
    const fileUrl = input.fileUrl || `https://storage.qubere.ai/docs/${fileName}`;

    const output = await DocumentIntakeAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      fileName,
      fileUrl,
      fileBuffer: input.fileBuffer,
      mimeType: input.mimeType,
      docTypeOverride: input.docTypeOverride,
    });

    state.packetId = output.packetId;
    state.intakeOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status,
      confidence: output.overallConfidence,
      summary: `Stitched packet ${output.packetId} (${output.pageCount} pages, Type: ${output.classifications[0]?.docTypeName || "Unknown"})`,
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class DocumentIntelligenceStep implements ComplianceAgent<PipelineOrchestrationInput, DocumentIntelligenceOutput> {
  readonly name = "Document Intelligence Agent";
  readonly stepNumber = 2;

  canExecute(state: AgentState): boolean {
    return Boolean(state.packetId);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<DocumentIntelligenceOutput>> {
    const fileName = input.fileName || "uploaded-trade-document.pdf";
    const output = await DocumentIntelligenceAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      packetId: state.packetId,
      fileBuffer: input.fileBuffer,
      fileName,
      mimeType: input.mimeType,
      docTypeCode: state.intakeOutput?.classifications[0]?.docTypeCode,
      state,
    });

    state.intelligenceOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status,
      confidence: output.confidenceMetrics,
      summary: `Extracted ${output.lineItems.length} line items (Origin: ${output.originCountry || "Unknown"}, Invoice Value: ${output.invoiceSubtotal !== null ? `$${output.invoiceSubtotal}` : "NULL [Invoice Missing]"}).`,
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class ProductIntelligenceStep implements ComplianceAgent<PipelineOrchestrationInput, ProductIntelligenceOutput> {
  readonly name = "Product Intelligence Agent";
  readonly stepNumber = 3;

  canExecute(state: AgentState): boolean {
    return Boolean(state.intelligenceOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<ProductIntelligenceOutput>> {
    const intel = state.intelligenceOutput;
    const output = await ProductIntelligenceAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      lineItems: (intel?.lineItems || [] as LineItemExtraction[]).map((li: LineItemExtraction) => ({
        lineNumber: li.lineNumber,
        sku: li.sku || undefined,
        description: li.description,
      })),
    });

    state.productOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status === "Completed" ? "Completed" : "Review Required",
      confidence: output.confidence,
      summary: output.status === "Completed"
        ? `Enriched ${output.profiles.length} SKU profiles with GRI 3(b) essential character`
        : "Product Intelligence Paused: Waiting for OCR / Product Description Extraction",
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class HTSClassificationStep implements ComplianceAgent<PipelineOrchestrationInput, HTSClassificationOutput> {
  readonly name = "HTS Classification Agent";
  readonly stepNumber = 4;

  canExecute(state: AgentState): boolean {
    return Boolean(state.productOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<HTSClassificationOutput>> {
    const prod = state.productOutput;
    const output = await HTSClassificationAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      productProfiles: (prod?.profiles || [] as EnrichedProductProfile[]).map((p: EnrichedProductProfile, idx: number) => ({
        lineNumber: idx + 1,
        rawDescription: p.rawDescription,
        enrichedDescription: p.enrichedDescription,
        essentialCharacter: p.essentialCharacter,
      })),
    });

    state.classificationOutput = output;
    state.evaluatorRefinementsCount = (state.evaluatorRefinementsCount || 0) + 1;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status === "Completed" ? "Completed" : "Review Required",
      confidence: output.overallConfidence,
      summary: output.status === "Completed"
        ? `Classified line item to HTS ${output.classifications[0]?.htsCode}${output.classifications[0]?.evaluatorScore !== null ? ` (Evaluator Score: ${output.classifications[0]?.evaluatorScore}%)` : ""}`
        : "HTS Classification Blocked: No Valid Product Description Present",
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class OriginRulesStep implements ComplianceAgent<PipelineOrchestrationInput, OriginRulesOutput> {
  readonly name = "Origin & Trade Agreement Agent";
  readonly stepNumber = 5;

  canExecute(state: AgentState): boolean {
    return Boolean(state.classificationOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<OriginRulesOutput>> {
    const classif = state.classificationOutput;
    const intel = state.intelligenceOutput;
    const isHtsBlocked = classif?.status === "BLOCKED_MISSING_DESCRIPTION";

    const output = await OriginRulesAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      lineItems: isHtsBlocked || !intel?.originCountry
        ? []
        : (classif?.classifications || [] as ClassificationResultItem[]).map((c: ClassificationResultItem) => ({
            lineNumber: c.lineNumber,
            htsCode: c.htsCode,
            manufacturingCountry: intel?.originCountry || undefined,
          })),
    });

    state.originOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status === "Completed" ? "Completed" : "Review Required",
      confidence: output.status === "Completed" ? 90 : 0,
      summary: output.status === "Completed"
        ? `Qualified ${output.qualifications[0]?.countryOfOrigin} (${output.qualifications[0]?.ftaProgram}${output.qualifications[0]?.estimatedSavings !== null ? ` - Duty Savings: $${output.qualifications[0]?.estimatedSavings}` : ""})`
        : "Origin Rules BLOCKED: Country of origin or product HTS classification unavailable",
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class ValuationAssistsStep implements ComplianceAgent<PipelineOrchestrationInput, ValuationAssistsOutput> {
  readonly name = "Valuation & Assists Agent";
  readonly stepNumber = 6;

  canExecute(): boolean {
    return true;
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<ValuationAssistsOutput>> {
    const intel = state.intelligenceOutput;
    const output = await ValuationAssistsAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      invoiceSubtotal: intel?.invoiceSubtotal ?? null,
    });

    state.valuationOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status === "Skipped - Missing Invoice Data" ? "Review Required" : output.status,
      confidence: output.confidenceMetrics,
      summary: output.enteredCustomsValue !== null
        ? `Computed Entered Customs Value $${output.enteredCustomsValue} (Transaction Value Method 1)`
        : "Valuation Skipped: Missing Commercial Invoice Pricing Data",
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class ComplianceAuditStep implements ComplianceAgent<PipelineOrchestrationInput, ComplianceAuditOutput> {
  readonly name = "Compliance & Audit Risk Agent";
  readonly stepNumber = 7;

  canExecute(state: AgentState): boolean {
    return Boolean(state.classificationOutput && state.originOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<ComplianceAuditOutput>> {
    const classif = state.classificationOutput;
    const intel = state.intelligenceOutput;
    const origin = state.originOutput;
    const isHtsBlocked = classif?.status === "BLOCKED_MISSING_DESCRIPTION";
    const isOriginBlocked = origin?.status === "BLOCKED_DEPENDENCY";

    const output = await ComplianceAuditAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      htsCode: classif?.classifications[0]?.htsCode,
      countryOfOrigin: intel?.originCountry,
      supplierName: intel?.exporterName || undefined,
      isHtsBlocked: isHtsBlocked || isOriginBlocked,
    });

    state.complianceOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status === "Completed" ? "Completed" : "Review Required",
      confidence: output.status === "Completed" ? 95 : 0,
      summary: output.status === "Completed"
        ? `Audited pre-filing rules (Risk Score: ${output.riskScore}, UFLPA Cleared)`
        : "Compliance Audit BLOCKED: Prerequisites Missing (HTS classification unavailable, Origin unverified)",
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class FilingReadinessStep implements ComplianceAgent<PipelineOrchestrationInput, FilingReadinessOutput> {
  readonly name = "Filing Readiness Agent";
  readonly stepNumber = 8;

  canExecute(state: AgentState): boolean {
    return Boolean(state.complianceOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<FilingReadinessOutput>> {
    const classif = state.classificationOutput;
    const origin = state.originOutput;
    const compliance = state.complianceOutput;
    const intel = state.intelligenceOutput;
    const val = state.valuationOutput;

    const isHtsBlocked = classif?.status === "BLOCKED_MISSING_DESCRIPTION";
    const isOriginBlocked = origin?.status === "BLOCKED_DEPENDENCY";
    const isComplianceBlocked = compliance?.status === "BLOCKED_DEPENDENCY";

    const output = await FilingReadinessAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      enteredValue: val?.enteredCustomsValue ?? null,
      dutyDue: 0.0,
      lineItemCount: intel?.lineItems.length || 0,
      hasCommercialInvoice: Boolean(intel?.hasCommercialInvoice),
      isHtsBlocked,
      isOriginBlocked,
      isComplianceBlocked,
    });

    state.readinessOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status,
      confidence: output.readinessScore,
      summary: output.readyForTransmission
        ? `Form 7501 Verified (Readiness Score: ${output.readinessScore}%, Ready for ACE)`
        : `Filing Readiness BLOCKED: ${output.missingRequirements.join(", ")}`,
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class CustomsFilingStep implements ComplianceAgent<PipelineOrchestrationInput, CustomsFilingOutput> {
  readonly name = "Customs Filing Agent";
  readonly stepNumber = 9;

  canExecute(state: AgentState): boolean {
    return Boolean(state.readinessOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<CustomsFilingOutput>> {
    const readiness = state.readinessOutput;
    const val = state.valuationOutput;

    const output = await CustomsFilingAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      enteredValue: val?.enteredCustomsValue ?? null,
      dutyDue: 0.0,
      readyForTransmission: Boolean(readiness?.readyForTransmission),
    });

    state.filingOutput = output;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status,
      confidence: output.aceResponse.status === "ACCEPTED" ? 100 : 0,
      summary: output.aceResponse.status === "ACCEPTED"
        ? `Transmitted to CBP ACE (Entry #${output.aceResponse.cbpEntryNumber}, Action: ${output.aceResponse.cbpActionCode})`
        : `ACE Transmission BLOCKED: ${output.aceResponse.cbpActionCode}`,
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

export class ResponseManagementStep implements ComplianceAgent<PipelineOrchestrationInput, ResponseManagementOutput> {
  readonly name = "Response & Post-Summary Agent";
  readonly stepNumber = 10;

  canExecute(state: AgentState): boolean {
    return Boolean(state.filingOutput);
  }

  async execute(state: AgentState, input: PipelineOrchestrationInput): Promise<AgentResult<ResponseManagementOutput>> {
    const filing = state.filingOutput;
    const intel = state.intelligenceOutput;

    const output = await ResponseManagementAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      entryNumber: filing?.aceResponse.cbpEntryNumber || "",
      hasCommercialInvoice: Boolean(intel?.hasCommercialInvoice),
    });

    state.responseOutput = output;
    state.evaluatorRefinementsCount = (state.evaluatorRefinementsCount || 1) + 1;

    return {
      agentName: this.name,
      stepNumber: this.stepNumber,
      status: output.status === "Completed" ? "Completed" : "Review Required",
      confidence: intel?.hasCommercialInvoice ? 95 : 0,
      summary: `Post-Summary scan complete: $${output.totalPotentialRefund} in refund opportunities identified.`,
      aiProviderUsed: output.aiProviderUsed,
      decisionId: output.agentDecisionId,
      output,
    };
  }
}

// -----------------------------------------------------------------------------
// WORKFLOW ENGINE: Decoupled Multi-Agent Compliance Pipeline Runner
// -----------------------------------------------------------------------------

export class ComplianceWorkflowEngine {
  private steps: ComplianceAgent[] = [
    new DocumentIntakeStep(),
    new DocumentIntelligenceStep(),
    new ProductIntelligenceStep(),
    new HTSClassificationStep(),
    new OriginRulesStep(),
    new ValuationAssistsStep(),
    new ComplianceAuditStep(),
    new FilingReadinessStep(),
    new CustomsFilingStep(),
    new ResponseManagementStep(),
  ];

  async executePipeline(input: PipelineOrchestrationInput): Promise<{
    state: AgentState;
    output: PipelineOrchestrationOutput;
  }> {
    const state = new AgentState(
      input.accountId,
      input.userId,
      input.shipmentId,
      input.triggerEvent || "DOCUMENT_UPLOADED",
      input.invokedBy || (input.fileName ? `Document Upload — ${input.fileName}` : "Document Upload")
    );

    // Execute registered agent steps in order
    for (const step of this.steps) {
      if (!step.canExecute(state)) {
        console.log(`[Agent ${step.stepNumber}/10: ${step.name}] ⏭️  SKIPPED — Prerequisites missing from AgentState context.`);
        state.recordAgentExecution({
          agentName: step.name,
          stepNumber: step.stepNumber,
          timestamp: new Date().toISOString(),
          status: "Review Required",
          summary: `${step.name} SKIPPED: Prerequisites missing from AgentState context.`,
          confidence: 0,
          aiProviderUsed: "SYSTEM_GATE",
          decisionId: `dec_skipped_${Date.now()}_${step.stepNumber}`,
          durationMs: 0,
        });
        continue;
      }

      console.log(`[Agent ${step.stepNumber}/10: ${step.name}] 🚀 WAKING UP — Processing Shipment ${input.shipmentId}...`);
      const stepStartTime = Date.now();

      const result = await step.execute(state, input);

      const durationMs = Date.now() - stepStartTime;
      const nextStep = this.steps.find((s) => s.stepNumber === step.stepNumber + 1);
      const handoffTarget = nextStep ? `Agent ${nextStep.stepNumber}: ${nextStep.name}` : "WORKFLOW_COMPLETE";

      console.log(`[Agent ${step.stepNumber}/10: ${step.name}] ✅ FINISHED (${durationMs}ms) | Status: ${result.status} | Handing off context -> ${handoffTarget}`);

      state.recordAgentExecution({
        agentName: result.agentName,
        stepNumber: result.stepNumber,
        timestamp: new Date().toISOString(),
        status: result.status as any,
        summary: result.summary,
        confidence: result.confidence as any,
        aiProviderUsed: result.aiProviderUsed,
        decisionId: result.decisionId,
        durationMs,
      });
    }


    // Persist AgentState to PostgreSQL asynchronously for audit defense
    await state.persistToDatabase().catch((err) => {
      console.warn("[ComplianceWorkflowEngine] Async DB audit persistence failed:", err);
    });

    const agent1 = state.intakeOutput!;
    const agent2 = state.intelligenceOutput!;
    const agent3 = state.productOutput!;
    const agent4 = state.classificationOutput!;
    const agent5 = state.originOutput!;
    const agent6 = state.valuationOutput!;
    const agent7 = state.complianceOutput!;
    const agent8 = state.readinessOutput!;
    const agent9 = state.filingOutput!;
    const agent10 = state.responseOutput!;

    // Machine-Readable Blocking Reason Codes
    const blockingReasonCodes: string[] = [];
    if (!agent2.hasCommercialInvoice) blockingReasonCodes.push("MISSING_COMMERCIAL_INVOICE");
    if (agent2.invoiceSubtotal === null) blockingReasonCodes.push("MISSING_TRANSACTION_VALUE");
    if (agent3.status === "WAITING_FOR_EXTRACTION") blockingReasonCodes.push("MISSING_PRODUCT_DESCRIPTION");
    if (agent4.status === "BLOCKED_MISSING_DESCRIPTION") blockingReasonCodes.push("BLOCKED_HTS_CLASSIFICATION");
    if (agent5.status === "BLOCKED_DEPENDENCY") blockingReasonCodes.push("BLOCKED_ORIGIN_DETERMINATION");
    if (agent7.status === "BLOCKED_DEPENDENCY") blockingReasonCodes.push("BLOCKED_COMPLIANCE_AUDIT");
    if (!agent8.readyForTransmission) blockingReasonCodes.push("BLOCKED_FILING_READINESS");

    const pipelineStatus = blockingReasonCodes.length === 0 ? "Completed" : "Review Required";
    const status: "COMPLETED" | "BLOCKED" = blockingReasonCodes.length === 0 ? "COMPLETED" : "BLOCKED";
    const userActionStatus: "ACTION_REQUIRED" | "NONE" = status === "COMPLETED" ? "NONE" : "ACTION_REQUIRED";

    // Actionable Human Review Task with Required Fields
    const requiredFields: RequiredFieldRequirement[] = [];
    if (!agent2.hasCommercialInvoice) {
      requiredFields.push({
        field: "commercialInvoice",
        reason: "Required for CBP importer of record entry packet declaration (19 CFR § 141.86)",
      });
    }
    if (agent2.invoiceSubtotal === null) {
      requiredFields.push({
        field: "invoiceSubtotal",
        reason: "Required for Transaction Value Method 1 valuation appraisal (19 U.S.C. § 1401a)",
      });
    }
    if (!agent2.currency) {
      requiredFields.push({
        field: "currency",
        reason: "Required for CBP official currency conversion and entered value calculation",
      });
    }
    if (agent3.status === "WAITING_FOR_EXTRACTION") {
      requiredFields.push({
        field: "productDescription",
        reason: "Required for GRI 1-6 10-digit HTS tariff code resolution and essential character verification",
      });
    }
    if (!agent2.exporterName) {
      requiredFields.push({
        field: "exporterName",
        reason: "Required for Manufacturer Identification (MID) code generation (19 CFR Part 102)",
      });
    }

    const humanReviewTask: HumanReviewTask | null = blockingReasonCodes.length > 0
      ? {
          taskId: `task_${Date.now()}`,
          priority: "HIGH",
          assignedTeam: "Customs Brokerage Operations",
          reason: `Pipeline blocked due to missing commercial data: ${blockingReasonCodes.join(", ")}`,
          requiredAction: "Upload itemized Commercial Invoice with pricing breakdown or provide verified product description",
          requiredFields,
          slaHours: 24,
        }
      : null;

    const humanActions: string[] = [];
    if (!agent2.hasCommercialInvoice) humanActions.push("Upload itemized Commercial Invoice with total pricing & currency");
    if (agent3.status === "WAITING_FOR_EXTRACTION") humanActions.push("Provide verified product description for HTS 10-digit classification");
    if (!agent2.exporterName) humanActions.push("Confirm Exporter / Shipper name and address");
    if (humanActions.length === 0) humanActions.push("Review CBP Form 7501 draft entry and click Transmit to ACE");

    // Blocker Ownership & Cause Mapping
    const blockers: BlockerDetail[] = [
      ...(!agent2.hasCommercialInvoice ? [{
        code: "MISSING_COMMERCIAL_INVOICE",
        severity: "CRITICAL" as const,
        ownerAgent: "Document Intelligence Agent",
        causedBy: ["Commercial Invoice document missing from packet"],
        message: "Commercial Invoice missing from filing packet",
      }] : []),
      ...(agent2.invoiceSubtotal === null ? [{
        code: "MISSING_TRANSACTION_VALUE",
        severity: "CRITICAL" as const,
        ownerAgent: "Valuation & Assists Agent",
        causedBy: ["Commercial Invoice pricing missing (Agent 2)"],
        message: "Appraised customs value missing due to absent invoice subtotal",
      }] : []),
      ...(agent3.status === "WAITING_FOR_EXTRACTION" ? [{
        code: "MISSING_PRODUCT_DESCRIPTION",
        severity: "HIGH" as const,
        ownerAgent: "Product Intelligence Agent",
        causedBy: ["OCR text extraction yielded no valid product description"],
        message: "Product description missing for SKU enrichment",
      }] : []),
      ...(agent4.status === "BLOCKED_MISSING_DESCRIPTION" ? [{
        code: "BLOCKED_HTS_CLASSIFICATION",
        severity: "CRITICAL" as const,
        ownerAgent: "HTS Classification Agent",
        causedBy: ["Product description missing (Agent 3)"],
        message: "HTS 10-digit classification blocked without verified product description",
      }] : []),
      ...(agent5.status === "BLOCKED_DEPENDENCY" ? [{
        code: "BLOCKED_ORIGIN_DETERMINATION",
        severity: "HIGH" as const,
        ownerAgent: "Origin & Trade Agreement Agent",
        causedBy: ["Country of origin unverified (Agent 2)", "HTS classification unavailable (Agent 4)"],
        message: "Origin rules evaluation blocked without origin / HTS data",
      }] : []),
      ...(agent7.status === "BLOCKED_DEPENDENCY" ? [{
        code: "BLOCKED_COMPLIANCE_AUDIT",
        severity: "CRITICAL" as const,
        ownerAgent: "Compliance & Audit Risk Agent",
        causedBy: ["HTS classification unavailable (Agent 4)", "Origin unverified (Agent 5)"],
        message: "Compliance pre-filing audit blocked due to missing HTS and Origin dependencies",
      }] : []),
      ...(!agent8.readyForTransmission ? [{
        code: "BLOCKED_FILING_READINESS",
        severity: "CRITICAL" as const,
        ownerAgent: "Filing Readiness Agent",
        causedBy: ["Form 7501 verification incomplete", "Missing commercial invoice"],
        message: "Form 7501 readiness gate failed",
      }] : []),
    ];

    const allStatuses = [
      agent1.status, agent2.status, agent3.status, agent4.status, agent5.status,
      agent6.status, agent7.status, agent8.status, agent9.status, agent10.status,
    ];

    const isSkipped = (s: any) => String(s).startsWith("Skipped");
    const isCompleted = (s: any) => s === "Completed" || String(s) === "ACCEPTED" || String(s) === "COMPLETED_NO_ACTION";

    const completedCount = allStatuses.filter(isCompleted).length;
    const skippedCount = allStatuses.filter(isSkipped).length;
    const blockedCount = 10 - completedCount - skippedCount;

    const canonicalShipmentState: CanonicalShipmentState = {
      shipmentId: input.shipmentId,
      lifecycleStatus: status,
      userActionStatus,
      completeness: {
        score: agent2.confidenceMetrics.dataCompleteness,
        missingFields: agent2.missingFields,
      },
      compliance: {
        status: agent7.status === "Completed" ? "CLEARED" : "BLOCKED_DEPENDENCY",
        reason: agent7.status === "Completed"
          ? "All pre-filing compliance audits cleared"
          : "Compliance audit blocked due to missing HTS and Origin dependencies",
      },
      filing: {
        status: agent8.readyForTransmission ? "READY" : "NOT_READY",
        blockersCount: blockers.length,
      },
      confidence: {
        extraction: agent2.confidenceMetrics.extractionConfidence,
        completeness: agent2.confidenceMetrics.dataCompleteness,
        filing: agent8.readinessScore,
      },
      humanTasksCount: humanReviewTask ? 1 : 0,
    };

    const output: PipelineOrchestrationOutput = {
      shipmentId: input.shipmentId,
      packetId: agent1.packetId,
      status,
      lifecycleStatus: status,
      userActionStatus,
      pipelineStatus,
      canonicalShipmentState,
      blockingReasonCodes,
      readiness: {
        score: agent8.readinessScore,
        readyForTransmission: agent8.readyForTransmission,
        blockers,
      },
      extractedData: {
        exporter: agent2.exporterName,
        importer: agent2.importerName,
        originCountry: agent2.originCountry,
        hasCommercialInvoice: agent2.hasCommercialInvoice,
        invoiceSubtotal: agent2.invoiceSubtotal,
        currency: agent2.currency,
        lineItemsCount: agent2.lineItems.length,
        isValidCommercialInvoice: agent2.isValidCommercialInvoice,
        validationFailures: agent2.validationFailures,
      },
      agentsSummary: {
        total: 10,
        completed: completedCount,
        blocked: blockedCount,
        skipped: skippedCount,
      },
      humanActions,
      humanReviewTask,
      auditTrailUrl: `/api/audit/room/${input.shipmentId}`,
      totalAgentsExecuted: 10,
      stateHistoryCount: state.history?.length || 10,
      mathValidationPassed: agent2.mathValidationPassed,
      mathDiscrepancies: state.mathDiscrepancies,
      evaluatorRefinementsCount: state.evaluatorRefinementsCount || 2,
      agentResults: {
        agent1_intake: agent1,
        agent2_intelligence: agent2,
        agent3_product: agent3,
        agent4_classification: agent4,
        agent5_origin: agent5,
        agent6_valuation: agent6,
        agent7_compliance: agent7,
        agent8_readiness: agent8,
        agent9_filing: agent9,
        agent10_response: agent10,
      },
    };

    return { state, output };
  }
}
