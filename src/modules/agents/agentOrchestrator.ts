import { DocumentIntakeAgent, DocumentIntakeAgentOutput } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent, DocumentIntelligenceOutput } from "./documentIntelligenceAgent";
import { ProductIntelligenceAgent, ProductIntelligenceOutput } from "./productIntelligenceAgent";
import { HTSClassificationAgent, HTSClassificationOutput } from "./htsClassificationAgent";
import { OriginRulesAgent, OriginRulesOutput } from "./originRulesAgent";
import { ValuationAssistsAgent, ValuationAssistsOutput } from "./valuationAssistsAgent";
import { ComplianceAuditAgent, ComplianceAuditOutput } from "./complianceAuditAgent";
import { FilingReadinessAgent, FilingReadinessOutput } from "./filingReadinessAgent";
import { CustomsFilingAgent, CustomsFilingOutput } from "./customsFilingAgent";
import { ResponseManagementAgent, ResponseManagementOutput } from "./responseManagementAgent";
import { AgentState, MultiDimensionalConfidence } from "./agentState";

export interface PipelineOrchestrationInput {
  accountId: string;
  userId: string;
  shipmentId: string;
  fileName?: string;
  fileUrl?: string;
  fileBuffer?: Buffer;
}

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

export interface PipelineOrchestrationOutput {
  shipmentId: string;
  packetId: string;
  status: "COMPLETED" | "BLOCKED" | "REVIEW_REQUIRED";
  pipelineStatus: "Completed" | "Review Required";
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

export class AgentOrchestrator {
  /**
   * Pipeline Execution Engine: Runs all 10 AI Agents with AgentState context passing,
   * Google ADK Math Reconciliation Gates, Dependency Gating, and Anthropic Evaluator-Optimizer loops.
   */
  static async runFullPipeline(input: PipelineOrchestrationInput): Promise<PipelineOrchestrationOutput> {
    const fileName = input.fileName || "uploaded-trade-document.pdf";
    const fileUrl = input.fileUrl || `https://storage.qubere.ai/docs/${fileName}`;

    // Initialize AgentState Context (Google ADK Pattern)
    const state = new AgentState(input.accountId, input.userId, input.shipmentId);

    // 1. Agent 1: Document Intake
    const agent1 = await DocumentIntakeAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      fileName,
      fileUrl,
      fileBuffer: input.fileBuffer,
    });
    state.packetId = agent1.packetId;
    state.intakeOutput = agent1;
    state.recordAgentExecution({
      agentName: "Document Intake Agent",
      stepNumber: 1,
      timestamp: new Date().toISOString(),
      status: agent1.status,
      summary: `Stitched packet ${agent1.packetId} (${agent1.pageCount} pages, Type: ${agent1.classifications[0]?.docTypeName || "Unknown"})`,
      confidence: {
        dataConfidence: agent1.overallConfidence,
        ruleConfidence: 98,
        decisionConfidence: agent1.overallConfidence,
      },
      aiProviderUsed: agent1.aiProviderUsed,
      decisionId: agent1.agentDecisionId,
    });

    // 2. Agent 2: Document Intelligence (with Zero-Hallucination Grounding Gate & KV Discovery)
    const agent2 = await DocumentIntelligenceAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      packetId: agent1.packetId,
      fileBuffer: input.fileBuffer,
      fileName,
      docTypeCode: agent1.classifications[0]?.docTypeCode,
      state,
    });
    state.intelligenceOutput = agent2;
    state.recordAgentExecution({
      agentName: "Document Intelligence Agent",
      stepNumber: 2,
      timestamp: new Date().toISOString(),
      status: agent2.status,
      summary: `Extracted ${agent2.lineItems.length} line items (Origin: ${agent2.originCountry || "Unknown"}, Invoice Value: ${agent2.invoiceSubtotal !== null ? `$${agent2.invoiceSubtotal}` : "NULL [Invoice Missing]"}).`,
      confidence: agent2.confidenceMetrics,
      aiProviderUsed: agent2.aiProviderUsed,
      decisionId: agent2.agentDecisionId,
    });

    // 3. Agent 3: Product Intelligence (with Prerequisite Gating)
    const agent3 = await ProductIntelligenceAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      lineItems: agent2.lineItems.map((li) => ({
        lineNumber: li.lineNumber,
        sku: li.sku || undefined,
        description: li.description,
      })),
    });
    state.productOutput = agent3;
    state.recordAgentExecution({
      agentName: "Product Intelligence Agent",
      stepNumber: 3,
      timestamp: new Date().toISOString(),
      status: agent3.status === "Completed" ? "Completed" : "Review Required",
      summary: agent3.status === "Completed"
        ? `Enriched ${agent3.profiles.length} SKU profiles with GRI 3(b) essential character`
        : "Product Intelligence Paused: Waiting for OCR / Product Description Extraction",
      confidence: {
        dataConfidence: agent3.confidence,
        ruleConfidence: 95,
        decisionConfidence: agent3.confidence,
      },
      aiProviderUsed: agent3.aiProviderUsed,
      decisionId: agent3.agentDecisionId,
    });

    // 4. Agent 4: HTS Classification (with Anthropic Evaluator-Optimizer Loop & Gating)
    const agent4 = await HTSClassificationAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      productProfiles: agent3.profiles.map((p, idx) => ({
        lineNumber: idx + 1,
        rawDescription: p.rawDescription,
        enrichedDescription: p.enrichedDescription,
        essentialCharacter: p.essentialCharacter,
      })),
    });
    state.classificationOutput = agent4;
    state.evaluatorRefinementsCount = (state.evaluatorRefinementsCount || 0) + 1;
    state.recordAgentExecution({
      agentName: "HTS Classification Agent",
      stepNumber: 4,
      timestamp: new Date().toISOString(),
      status: agent4.status === "Completed" ? "Completed" : "Review Required",
      summary: agent4.status === "Completed"
        ? `Classified line item to HTS ${agent4.classifications[0]?.htsCode} (Evaluator Score: ${agent4.classifications[0]?.evaluatorScore}%)`
        : "HTS Classification Blocked: No Valid Product Description Present",
      confidence: {
        dataConfidence: agent4.overallConfidence,
        ruleConfidence: 98,
        decisionConfidence: agent4.overallConfidence,
      },
      aiProviderUsed: agent4.aiProviderUsed,
      decisionId: agent4.agentDecisionId,
    });

    // 5. Agent 5: Origin & Trade Agreement (with Strict Dependency Gating)
    const isHtsBlocked = agent4.status === "BLOCKED_MISSING_DESCRIPTION";
    const agent5 = await OriginRulesAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      lineItems: isHtsBlocked || !agent2.originCountry
        ? []
        : agent4.classifications.map((c) => ({
            lineNumber: c.lineNumber,
            htsCode: c.htsCode,
            manufacturingCountry: agent2.originCountry || undefined,
          })),
    });
    state.originOutput = agent5;
    state.recordAgentExecution({
      agentName: "Origin & Trade Agreement Agent",
      stepNumber: 5,
      timestamp: new Date().toISOString(),
      status: agent5.status === "Completed" ? "Completed" : "Review Required",
      summary: agent5.status === "Completed"
        ? `Qualified ${agent5.qualifications[0]?.countryOfOrigin} (${agent5.qualifications[0]?.ftaProgram} - Duty Savings: $${agent5.qualifications[0]?.estimatedSavings})`
        : "Origin Rules BLOCKED: Country of origin or product HTS classification unavailable",
      confidence: {
        dataConfidence: agent5.status === "Completed" ? 90 : 0,
        ruleConfidence: 98,
        decisionConfidence: agent5.status === "Completed" ? 90 : 0,
      },
      aiProviderUsed: agent5.aiProviderUsed,
      decisionId: agent5.agentDecisionId,
    });

    // 6. Agent 6: Valuation & Assists (Conditional Appraisal)
    const agent6 = await ValuationAssistsAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      invoiceSubtotal: agent2.invoiceSubtotal,
    });
    state.valuationOutput = agent6;
    state.recordAgentExecution({
      agentName: "Valuation & Assists Agent",
      stepNumber: 6,
      timestamp: new Date().toISOString(),
      status: agent6.status === "Skipped - Missing Invoice Data" ? "Review Required" : agent6.status,
      summary: agent6.enteredCustomsValue !== null
        ? `Computed Entered Customs Value $${agent6.enteredCustomsValue} (Transaction Value Method 1)`
        : "Valuation Skipped: Missing Commercial Invoice Pricing Data",
      confidence: {
        dataConfidence: agent2.invoiceSubtotal !== null ? 95 : 0,
        ruleConfidence: 95,
        decisionConfidence: agent2.invoiceSubtotal !== null ? 95 : 0,
      },
      aiProviderUsed: agent6.aiProviderUsed,
      decisionId: agent6.agentDecisionId,
    });

    // 7. Agent 7: Compliance & Audit Risk (with Strict Dependency Gating)
    const agent7 = await ComplianceAuditAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      htsCode: agent4.classifications[0]?.htsCode,
      countryOfOrigin: agent2.originCountry,
      supplierName: agent2.exporterName || undefined,
      isHtsBlocked: isHtsBlocked || agent5.status === "BLOCKED_DEPENDENCY",
    });
    state.complianceOutput = agent7;
    state.recordAgentExecution({
      agentName: "Compliance & Audit Risk Agent",
      stepNumber: 7,
      timestamp: new Date().toISOString(),
      status: agent7.status === "Completed" ? "Completed" : "Review Required",
      summary: agent7.status === "Completed"
        ? `Audited pre-filing rules (Risk Score: ${agent7.riskScore}, UFLPA Cleared)`
        : "Compliance Audit BLOCKED: Prerequisites Missing (HTS classification unavailable, Origin unverified)",
      confidence: {
        dataConfidence: agent7.status === "Completed" ? 95 : 0,
        ruleConfidence: 98,
        decisionConfidence: agent7.status === "Completed" ? 95 : 0,
      },
      aiProviderUsed: agent7.aiProviderUsed,
      decisionId: agent7.agentDecisionId,
    });

    // 8. Agent 8: Filing Readiness (Strict Completeness Gate)
    const agent8 = await FilingReadinessAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      enteredValue: agent6.enteredCustomsValue,
      dutyDue: 0.0,
      lineItemCount: agent2.lineItems.length,
      hasCommercialInvoice: agent2.hasCommercialInvoice,
    });
    state.readinessOutput = agent8;
    state.recordAgentExecution({
      agentName: "Filing Readiness Agent",
      stepNumber: 8,
      timestamp: new Date().toISOString(),
      status: agent8.status,
      summary: agent8.readyForTransmission
        ? `Form 7501 Verified (Readiness Score: ${agent8.readinessScore}%, Ready for ACE)`
        : `Filing Readiness BLOCKED: ${agent8.missingRequirements.join(", ")}`,
      confidence: {
        dataConfidence: agent8.readinessScore,
        ruleConfidence: 99,
        decisionConfidence: agent8.readinessScore,
      },
      aiProviderUsed: agent8.aiProviderUsed,
      decisionId: agent8.agentDecisionId,
    });

    // 9. Agent 9: Customs Filing Agent (Conditional Transmission)
    const agent9 = await CustomsFilingAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      enteredValue: agent6.enteredCustomsValue,
      dutyDue: 0.0,
      readyForTransmission: agent8.readyForTransmission,
    });
    state.filingOutput = agent9;
    state.recordAgentExecution({
      agentName: "Customs Filing Agent",
      stepNumber: 9,
      timestamp: new Date().toISOString(),
      status: agent9.status,
      summary: agent9.aceResponse.status === "ACCEPTED"
        ? `Transmitted to CBP ACE (Entry #${agent9.aceResponse.cbpEntryNumber}, Action: ${agent9.aceResponse.cbpActionCode})`
        : `ACE Transmission BLOCKED: ${agent9.aceResponse.cbpActionCode}`,
      confidence: {
        dataConfidence: agent9.aceResponse.status === "ACCEPTED" ? 100 : 0,
        ruleConfidence: 100,
        decisionConfidence: agent9.aceResponse.status === "ACCEPTED" ? 100 : 0,
      },
      aiProviderUsed: agent9.aiProviderUsed,
      decisionId: agent9.agentDecisionId,
    });

    // 10. Agent 10: Response & Post-Summary Agent
    const agent10 = await ResponseManagementAgent.execute({
      accountId: input.accountId,
      userId: input.userId,
      shipmentId: input.shipmentId,
      entryNumber: agent9.aceResponse.cbpEntryNumber,
      hasCommercialInvoice: agent2.hasCommercialInvoice,
    });
    state.responseOutput = agent10;
    state.evaluatorRefinementsCount = (state.evaluatorRefinementsCount || 1) + 1;
    state.recordAgentExecution({
      agentName: "Response & Post-Summary Agent",
      stepNumber: 10,
      timestamp: new Date().toISOString(),
      status: agent10.status,
      summary: `Post-Summary scan complete: $${agent10.totalPotentialRefund} in refund opportunities identified.`,
      confidence: {
        dataConfidence: agent2.hasCommercialInvoice ? 95 : 0,
        ruleConfidence: 98,
        decisionConfidence: agent2.hasCommercialInvoice ? 95 : 0,
      },
      aiProviderUsed: agent10.aiProviderUsed,
      decisionId: agent10.agentDecisionId,
    });

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
    const status = blockingReasonCodes.length === 0 ? "COMPLETED" : "BLOCKED";

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

    // Summary Math: completed + blocked + skipped = 10 (Strict Identity)
    const allStatuses = [
      agent1.status, agent2.status, agent3.status, agent4.status, agent5.status,
      agent6.status, agent7.status, agent8.status, agent9.status, agent10.status,
    ];

    const isSkipped = (s: any) => String(s).startsWith("Skipped");
    const isCompleted = (s: any) => s === "Completed" || String(s) === "ACCEPTED";

    const completedCount = allStatuses.filter(isCompleted).length;
    const skippedCount = allStatuses.filter(isSkipped).length;
    const blockedCount = 10 - completedCount - skippedCount;

    return {
      shipmentId: input.shipmentId,
      packetId: agent1.packetId,
      status,
      pipelineStatus,
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
  }
}
