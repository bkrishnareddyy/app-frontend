const fs = require('fs');
const content = fs.readFileSync('src/modules/agents/workflowEngine.ts', 'utf-8');
const lines = content.split('\n');

const startIndex = lines.findIndex(l => l.includes('finalizePipeline(state: AgentState): PipelineOrchestrationOutput {'));

const beforeLines = lines.slice(0, startIndex);
const restOfFile = `  finalizePipeline(state: AgentState): PipelineOrchestrationOutput {
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

    const blockingReasonCodes: string[] = [];
    if (!agent2?.hasCommercialInvoice) blockingReasonCodes.push("MISSING_COMMERCIAL_INVOICE");
    if (agent2?.invoiceSubtotal === null) blockingReasonCodes.push("MISSING_TRANSACTION_VALUE");
    if (agent3?.status === "WAITING_FOR_EXTRACTION") blockingReasonCodes.push("MISSING_PRODUCT_DESCRIPTION");
    if (agent4?.status === "BLOCKED_MISSING_DESCRIPTION") blockingReasonCodes.push("BLOCKED_HTS_CLASSIFICATION");
    if (agent5?.status === "BLOCKED_DEPENDENCY") blockingReasonCodes.push("BLOCKED_ORIGIN_DETERMINATION");
    if (agent7?.status === "BLOCKED_DEPENDENCY") blockingReasonCodes.push("BLOCKED_COMPLIANCE_AUDIT");
    if (!agent8?.readyForTransmission) blockingReasonCodes.push("BLOCKED_FILING_READINESS");

    const pipelineStatus = blockingReasonCodes.length === 0 ? "Completed" : "Review Required";
    const status: "COMPLETED" | "BLOCKED" = blockingReasonCodes.length === 0 ? "COMPLETED" : "BLOCKED";
    const userActionStatus: "ACTION_REQUIRED" | "NONE" = status === "COMPLETED" ? "NONE" : "ACTION_REQUIRED";

    const blockers: BlockerDetail[] = [];
    const humanReviewTask: HumanReviewTask | null = null;
    const humanActions: string[] = [];

    const canonicalShipmentState: CanonicalShipmentState = {
      shipmentId: state.shipmentId,
      lifecycleStatus: status,
      userActionStatus,
      completeness: {
        score: agent2?.confidenceMetrics?.dataCompleteness || 0,
        missingFields: agent2?.missingFields || [],
      },
      compliance: {
        status: agent7?.status === "Completed" ? "CLEARED" : "BLOCKED_DEPENDENCY",
        reason: agent7?.status === "Completed" ? "All cleared" : "Blocked",
      },
      filing: {
        status: agent8?.readyForTransmission ? "READY" : "NOT_READY",
        blockersCount: blockers.length,
      },
      confidence: {
        extraction: agent2?.confidenceMetrics?.extractionConfidence || 0,
        completeness: agent2?.confidenceMetrics?.dataCompleteness || 0,
        filing: agent8?.readinessScore || 0,
      },
      humanTasksCount: humanReviewTask ? 1 : 0,
    };

    return {
      shipmentId: state.shipmentId,
      packetId: agent1?.packetId || "",
      status,
      lifecycleStatus: status,
      userActionStatus,
      pipelineStatus,
      canonicalShipmentState,
      blockingReasonCodes,
      readiness: {
        score: agent8?.readinessScore || 0,
        readyForTransmission: agent8?.readyForTransmission || false,
        blockers,
      },
      extractedData: {
        exporter: agent2?.exporterName || null,
        importer: agent2?.importerName || null,
        originCountry: agent2?.originCountry || null,
        hasCommercialInvoice: agent2?.hasCommercialInvoice || false,
        invoiceSubtotal: agent2?.invoiceSubtotal || null,
        currency: agent2?.currency || null,
        lineItemsCount: agent2?.lineItems?.length || 0,
        isValidCommercialInvoice: agent2?.isValidCommercialInvoice || false,
        validationFailures: agent2?.validationFailures || [],
      },
      agentsSummary: {
        total: 10,
        completed: 10 - blockingReasonCodes.length,
        blocked: blockingReasonCodes.length,
        skipped: 0,
      },
      humanActions,
      humanReviewTask,
      auditTrailUrl: \`/api/audit/room/\${state.shipmentId}\`,
      totalAgentsExecuted: 10,
      stateHistoryCount: state.history?.length || 10,
      mathValidationPassed: agent2?.mathValidationPassed || true,
      mathDiscrepancies: state.mathDiscrepancies || [],
      evaluatorRefinementsCount: state.evaluatorRefinementsCount || 0,
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

  async executePipeline(input: PipelineOrchestrationInput): Promise<{
    state: AgentState;
    output: PipelineOrchestrationOutput;
  }> {
    const state = new AgentState(input.accountId, input.userId, input.shipmentId);

    // Execute registered agent steps in order
    for (let i = 1; i <= this.totalSteps; i++) {
      await this.executeNextStep(input, i, state);
    }

    // Persist AgentState to PostgreSQL asynchronously for audit defense
    await state.persistToDatabase().catch((err) => {
      console.warn("[ComplianceWorkflowEngine] Async DB audit persistence failed:", err);
    });

    const output = this.finalizePipeline(state);
    return { state, output };
  }
}
`;

fs.writeFileSync('src/modules/agents/workflowEngine.ts', beforeLines.join('\n') + '\n' + restOfFile);
