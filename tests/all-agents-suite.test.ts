import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and audit calls
vi.mock("../src/lib/db", () => ({
  db: {
    shipmentDocument: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `doc_${Date.now()}`, ...data })),
    },
    agentDecision: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `dec_${Date.now()}`, ...data })),
    },
    hTSCode: {
      findMany: vi.fn().mockResolvedValue([
        { htsCode10: "7318.15.2065", description: "Screws and bolts of stainless steel" },
      ]),
    },
    customsFiling: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `filing_${Date.now()}`, ...data })),
    },
  },
}));

vi.mock("../src/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit_123" }),
}));

import { DocumentIntakeAgent } from "../src/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent } from "../src/modules/agents/documentIntelligenceAgent";
import { ProductIntelligenceAgent } from "../src/modules/agents/productIntelligenceAgent";
import { HTSClassificationAgent } from "../src/modules/agents/htsClassificationAgent";
import { OriginRulesAgent } from "../src/modules/agents/originRulesAgent";
import { ValuationAssistsAgent } from "../src/modules/agents/valuationAssistsAgent";
import { ComplianceAuditAgent } from "../src/modules/agents/complianceAuditAgent";
import { FilingReadinessAgent } from "../src/modules/agents/filingReadinessAgent";
import { CustomsFilingAgent } from "../src/modules/agents/customsFilingAgent";
import { ResponseManagementAgent } from "../src/modules/agents/responseManagementAgent";
import { AgentOrchestrator } from "../src/modules/agents/agentOrchestrator";

describe("Qubere 10 AI-Native Autonomous Agents & Architectural Patterns Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Agent 1 (Document Intake): should ingest multi-page files and stitch packets", async () => {
    const res = await DocumentIntakeAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      fileName: "Commercial_Invoice_INV99.pdf",
      fileUrl: "https://storage.qubere.ai/docs/inv99.pdf",
    });
    expect(res.status).toBe("Completed");
    expect(res.packetId).toBeDefined();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 2 (Document Intelligence): should execute Google ADK Math Reconciliation Gate", async () => {
    const res = await DocumentIntelligenceAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      packetId: "pkt_9921",
    });
    expect(res.exporterName).toBeDefined();
    expect(res.midCode).toBeDefined();
    expect(res.mathValidationPassed).toBe(true);
    expect(res.lineItems).toHaveLength(1);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 3 (Product Intelligence): should enrich SKU profiles and establish GRI 3(b) essential character", async () => {
    const res = await ProductIntelligenceAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, sku: "SKU-992", description: "Stainless Steel Fasteners 1/4-20" }],
    });
    expect(res.profiles[0].materialComposition).toBeDefined();
    expect(res.profiles[0].essentialCharacter).toContain("GRI 3(b)");
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 4 (HTS Classification): should execute Anthropic Evaluator-Optimizer Loop", async () => {
    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });
    expect(res.classifications[0].htsCode).toBe("7318.15.2065");
    expect(res.classifications[0].evaluatorScore).toBe(98);
    expect(res.classifications[0].legalRationale).toContain("Evaluator-Optimizer Turn");
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 5 (Origin Rules): should evaluate USMCA tariff shift CTH and preference criterion B", async () => {
    const res = await OriginRulesAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", manufacturingCountry: "MX" }],
    });
    expect(res.qualifications[0].ftaProgram).toBe("USMCA");
    expect(res.qualifications[0].spiCode).toBe("S");
    expect(res.qualifications[0].estimatedSavings).toBe(3007.0);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 6 (Valuation & Assists): should calculate Transaction Value 1401a and ocean freight deductions", async () => {
    const res = await ValuationAssistsAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      invoiceSubtotal: 48500.0,
      oceanFreightIncluded: 3200.0,
      buyerAssists: 1500.0,
    });
    expect(res.enteredCustomsValue).toBe(46800.0);
    expect(res.valuationMethod).toContain("TRANSACTION VALUE");
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 7 (Compliance Audit): should execute 52 pre-filing CBP rules and UFLPA screening", async () => {
    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      htsCode: "7318.15.2065",
      countryOfOrigin: "MX",
      supplierName: "Shenzhen Precision Hardware Corp",
    });
    expect(res.riskScore).toBe(0);
    expect(res.uflpaCleared).toBe(true);
    expect(res.auditChecksPassed).toBe(52);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 8 (Filing Readiness): should verify Form 7501 fields and continuous bond status", async () => {
    const res = await FilingReadinessAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      enteredValue: 46800.0,
      dutyDue: 0.0,
      lineItemCount: 1,
    });
    expect(res.readinessScore).toBeGreaterThanOrEqual(95);
    expect(res.readyForTransmission).toBe(true);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 9 (Customs Filing): should generate ABI payload and receive 1C Cargo Released status", async () => {
    const res = await CustomsFilingAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      enteredValue: 46800.0,
      dutyDue: 0.0,
    });
    expect(res.aceResponse.status).toBe("ACCEPTED");
    expect(res.aceResponse.cbpActionCode).toContain("1C");
    expect(res.customsFilingId).toBeDefined();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 10 (Response Management): should execute Anthropic Evaluator-Optimizer loop for PSC refund claims", async () => {
    const res = await ResponseManagementAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      entryNumber: "QBR-2026-8849102",
    });
    expect(res.totalPotentialRefund).toBe(2902.4);
    expect(res.evaluatorScore).toBe(97);
    expect(res.legalResponseDrafted).toBe(true);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Master Agent Orchestrator: should execute full 10-agent pipeline with AgentState context and math gates", async () => {
    const pipeline = await AgentOrchestrator.runFullPipeline({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      fileName: "Commercial_Invoice_INV-88421.pdf",
    });

    expect(pipeline.pipelineStatus).toBe("Completed");
    expect(pipeline.totalAgentsExecuted).toBe(10);
    expect(pipeline.stateHistoryCount).toBe(10);
    expect(pipeline.mathValidationPassed).toBe(true);
    expect(pipeline.evaluatorRefinementsCount).toBeGreaterThanOrEqual(2);
    expect(pipeline.agentResults.agent1_intake.packetId).toBeDefined();
    expect(pipeline.agentResults.agent4_classification.classifications[0].htsCode).toBe("7318.15.2065");
    expect(pipeline.agentResults.agent9_filing.aceResponse.cbpEntryNumber).toBeDefined();
    expect(pipeline.agentResults.agent10_response.totalPotentialRefund).toBe(2902.4);
  });
});
