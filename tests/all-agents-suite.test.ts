import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and audit calls
vi.mock("../src/lib/db", () => ({
  db: {
    account: {
      upsert: vi.fn(),
    },
    agentExecutionLog: {
      create: vi.fn().mockResolvedValue({ id: "log_1" }),
    },
    shipmentStateRecord: {
      upsert: vi.fn().mockResolvedValue({ id: "state_1" }),
    },
    shipmentDocument: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `doc_${Date.now()}`, ...data })),
    },
    agentDecision: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `dec_${Date.now()}`, ...data })),
    },
    htsNode: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "node_1",
          htsNumberDisplay: "7318.15.2065",
          htsNumberNormalized: "7318152065",
          description: "Screws and bolts of stainless steel",
          dutyRates: [{ rateColumn: "General", rawRateText: "Free" }],
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    customsFiling: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `filing_${Date.now()}`, ...data })),
    },
    embargoRule: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "er_kp",
          countryCode: "KP",
          countryName: "North Korea",
          regime: "Comprehensive Sanctions",
          restriction: "Comprehensive OFAC embargo.",
          authority: "US OFAC / CBP",
        },
      ]),
    },
    tradeBenchmark: {
      findFirst: vi.fn().mockResolvedValue(null),
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
import { AgentState } from "../src/modules/agents/agentState";
import { db } from "../src/lib/db";
import { createAuditLog } from "../src/lib/audit";

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
      docTypeOverride: "COMMERCIAL_INVOICE",
    });
    // Filename-only classification reports no OCR confidence, so the packet is held
    // for review rather than cleared for automated filing.
    expect(res.status).toBe("Review Required");
    expect(res.overallConfidence).toBeNull();
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
    expect(res.agentDecisionId).toBeDefined();
    expect(res.status).toBeDefined();
  });

  it("Agent 3 (Product Intelligence): should enrich SKU profiles and establish GRI 3(b) essential character", async () => {
    const res = await ProductIntelligenceAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, sku: "SKU-992", description: "Stainless Steel Fasteners 1/4-20" }],
    });
    expect(res.profiles[0].materialComposition).toBeDefined();
    expect(res.profiles[0].essentialCharacter).toBeDefined();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 4 (HTS Classification): should execute HTS Classification Agent", async () => {
    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20" }],
    });
    expect(res.classifications[0].htsCode).toBeDefined();
    expect(res.classifications[0].legalRationale).toBeDefined();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 4 (HTS Classification): abstains rather than suggesting an unrelated code when nothing matches", async () => {
    const { db } = await import("../src/lib/db");
    const findMany = db.htsNode.findMany as unknown as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValueOnce([]);

    const res = await HTSClassificationAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      productProfiles: [{ lineNumber: 1, rawDescription: "Zzzz nonexistent widget" }],
    });

    expect(res.classifications[0].htsCode).toBe("UNCLASSIFIABLE");
    expect(res.classifications[0].confidence).toBe(0);
    expect(res.classifications[0].crossRulings).toEqual([]);
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
    // Entered value and the HTS-specific rate are not available to this agent,
    // so no saving can be computed. It used to report a flat $3,007 per line.
    expect(res.qualifications[0].estimatedSavings).toBeNull();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 5 (Origin Rules): reports an undeclared manufacturing country as unknown, not as China", async () => {
    // The prerequisite gate only inspects line 1, so a later line with no declared
    // country used to fall through to a "CN" default and be reported as Chinese.
    const res = await OriginRulesAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [
        { lineNumber: 1, htsCode: "7318.15.2065", manufacturingCountry: "MX" },
        { lineNumber: 2, htsCode: "8481.80.1050" },
      ],
    });
    expect(res.qualifications[1].countryOfOrigin).toBeNull();
    expect(res.qualifications[1].ftaProgram).toBe("UNDETERMINED");
    expect(res.qualifications[1].tariffShiftMet).toBeNull();
  });

  it("Agent 6 (Valuation & Assists): should calculate Transaction Value 1401a and ocean freight deductions", async () => {
    const res = await ValuationAssistsAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      invoiceSubtotal: 48500.0,
      oceanFreight: 3200.0,
      buyerAssists: 1500.0,
    });
    expect(res.enteredCustomsValue).toBe(46800.0);
    expect(res.valuationMethod).toContain("TRANSACTION_VALUE");
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 7 (Compliance Audit): screens every line's origin against real embargo reference data", async () => {
    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", countryOfOrigin: "MX" }],
      supplierName: "Shenzhen Precision Hardware Corp",
    });
    expect(res.riskScore).toBe(0);
    expect(res.uflpaCleared).toBe(true);
    expect(res.auditChecksRun).toBeGreaterThan(0);
    expect(res.auditChecksPassed).toBe(res.auditChecksRun);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 7 (Compliance Audit): flags a sanctioned-origin line even when other lines are clean", async () => {
    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [
        { lineNumber: 1, htsCode: "7318.15.2065", countryOfOrigin: "MX" },
        { lineNumber: 2, htsCode: "8481.80.5090", countryOfOrigin: "KP" },
      ],
    });
    expect(res.riskScore).toBeGreaterThan(0);
    expect(res.uflpaCleared).toBe(false);
    expect(res.status).toBe("Review Required");
    const line2Finding = res.auditResults.find((r) => r.lineNumber === 2 && r.category === "UFLPA");
    expect(line2Finding?.passed).toBe(false);
    expect(line2Finding?.details).toContain("North Korea");
  });

  it("Agent 7 (Compliance Audit): flags a line missing HTS independently of other lines being fine", async () => {
    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [
        { lineNumber: 1, htsCode: "7318.15.2065", countryOfOrigin: "MX" },
        { lineNumber: 2, htsCode: null, countryOfOrigin: "IN" },
      ],
    });
    const missingHtsFinding = res.auditResults.find(
      (r) => r.lineNumber === 2 && r.category === "DATA_MISSING" && r.ruleId === "RULE-DATA-02"
    );
    expect(missingHtsFinding?.passed).toBe(false);
    const line1MissingHts = res.auditResults.find(
      (r) => r.lineNumber === 1 && r.category === "DATA_MISSING" && r.ruleId === "RULE-DATA-02"
    );
    expect(line1MissingHts).toBeUndefined();
  });

  it("Agent 7 (Compliance Audit): reports a screening gap rather than a false clear when no embargo rules are loaded", async () => {
    const { db } = await import("../src/lib/db");
    const findMany = db.embargoRule.findMany as unknown as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValueOnce([]);

    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", countryOfOrigin: "KP" }],
    });

    expect(res.uflpaCleared).toBe(false);
    const gapFinding = res.auditResults.find((r) => r.category === "SCREENING_GAP");
    expect(gapFinding).toBeDefined();
    expect(gapFinding?.details).toContain("not been screened");
    // With no rules loaded, no UFLPA match/no-match finding should be fabricated for the line.
    expect(res.auditResults.find((r) => r.category === "UFLPA")).toBeUndefined();
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

  it("Agent 8 (Filing Readiness): blocks the entry when duty was never calculated", async () => {
    const res = await FilingReadinessAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      enteredValue: 46800.0,
      lineItemCount: 1,
    });
    expect(res.readyForTransmission).toBe(false);
    expect(res.missingRequirements.join(" ")).toContain("duty");
    // An uncalculated duty must never surface on Form 7501 as $0.00.
    expect(res.form7501Preview.totalDutyDue).toBeNull();
  });

  it("Agent 9 (Customs Filing): should generate ABI payload and receive 1C Cargo Released status", async () => {
    const res = await CustomsFilingAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      enteredValue: 46800.0,
      dutyDue: 0.0,
      // Transmission is an authorized act; without this the agent stops at NOT_SUBMITTED.
      authorized: true,
    });
    expect(res.aceResponse.status).toBe("ACCEPTED");
    expect(res.aceResponse.cbpActionCode).toContain("1C");
    expect(res.customsFilingId).toBeDefined();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 10 (Response Management): claims no refund without a live USTR/CBP scan", async () => {
    const res = await ResponseManagementAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      entryNumber: "QBR-2026-8849102",
    });
    // "QBR-" is this system's own filer code, so the old isTestEntry flag
    // unlocked a fabricated $2,902.40 Section 301 refund on every real entry.
    expect(res.totalPotentialRefund).toBeNull();
    expect(res.refundOpportunities).toEqual([]);
    expect(res.evaluatorScore).toBeNull();
    expect(res.legalResponseDrafted).toBe(false);
    expect(res.status).toBe("COMPLETED_NO_ACTION");
    expect(res.agentDecisionId).toBeDefined();
  });

  // The "Master Agent Orchestrator" full-pipeline cases that used to live
  // here tested ComplianceWorkflowEngine/AgentOrchestrator directly. That
  // subsystem is gone: PipelineOrchestrator persists straight to Postgres
  // (Fact, ShipmentLineItem, ExceptionItem, AgentExecutionRecord) rather
  // than assembling an in-memory PipelineOrchestrationOutput report, so
  // there's no equivalent in-memory shape left to assert against here.
  // Covered instead by the plan's end-to-end verification against a running
  // dev server + real DB.

  it("Agents return a null decision id when the AgentDecision write fails", async () => {
    vi.mocked(db.agentDecision.create).mockRejectedValueOnce(new Error("db down"));

    const res = await OriginRulesAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", manufacturingCountry: "MX" }],
    });

    expect(res.agentDecisionId).toBeNull();
    // The audit trail must not reference a decision that was never written.
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("AgentState persistence never manufactures the tenant it is writing against", async () => {
    const state = new AgentState("acc_does_not_exist", "usr_1", "shp_1");
    state.recordAgentExecution({
      agentName: "Origin Agent",
      stepNumber: 5,
      timestamp: new Date().toISOString(),
      status: "Completed",
      summary: "Evaluated origin rules.",
      confidence: null,
      aiProviderUsed: "Deterministic Origin Rules Engine (19 CFR Part 102)",
      decisionId: null,
    });

    await state.persistToDatabase();

    expect(db.account.upsert).not.toHaveBeenCalled();
    expect(db.agentExecutionLog.create).toHaveBeenCalledTimes(1);
  });
});
