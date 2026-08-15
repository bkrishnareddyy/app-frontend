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
      // Mirrors Prisma's `where: { regime: { contains, mode: "insensitive" } }`
      // so the UFLPA-specific repository query (forcedLaborRepository.ts) sees
      // only the UFLPA-regime row, exactly like it would against a real DB.
      findMany: vi.fn().mockImplementation((args?: { where?: { regime?: { contains?: string } } }) => {
        const rows = [
          {
            id: "er_kp",
            countryCode: "KP",
            countryName: "North Korea",
            regime: "Comprehensive Sanctions",
            restriction: "Comprehensive OFAC embargo.",
            authority: "US OFAC / CBP",
          },
          {
            id: "er_uflpa_xj",
            countryCode: "UFLPA_XINJIANG",
            countryName: "China (Xinjiang)",
            regime: "UFLPA Forced Labor",
            restriction: "Rebuttable presumption of forced labor.",
            authority: "US OFAC / CBP UFLPA",
          },
        ];
        const contains = args?.where?.regime?.contains;
        if (!contains) return Promise.resolve(rows);
        return Promise.resolve(rows.filter((r) => r.regime.toLowerCase().includes(contains.toLowerCase())));
      }),
    },
    screeningEntity: {
      // Mirrors embargoRule's args-aware mock: filters by sourceList so
      // Phase 2's End-User/Military-End-User checks can genuinely run
      // (and resolve CLEAR) in tests that supply party names, without
      // ever matching those parties by accident.
      findMany: vi.fn().mockImplementation((args?: { where?: { sourceList?: string | { in?: string[] } } }) => {
        const rows = [
          { id: "se_uflpa", entityHash: "h_uflpa", entityType: "COMPANY", name: "Xinjiang Cotton Processing Co", alternateNames: [], address: null, city: null, country: "CN", nationalityCountry: null, programCodes: ["UFLPA"], remarks: null, sourceList: "UFLPA_ENTITY_LIST", publicationStatus: "PUBLISHED", publishedAt: new Date("2024-01-01"), supersededAt: null, sourcePublishedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01") },
          { id: "se_entitylist", entityHash: "h_el", entityType: "COMPANY", name: "Restricted Import Consortium LLC", alternateNames: [], address: null, city: null, country: "CN", nationalityCountry: null, programCodes: ["ENTITY_LIST"], remarks: null, sourceList: "ENTITY_LIST", publicationStatus: "PUBLISHED", publishedAt: new Date("2024-01-01"), supersededAt: null, sourcePublishedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01") },
          { id: "se_meu", entityHash: "h_meu", entityType: "COMPANY", name: "PLA Aviation Procurement Bureau", alternateNames: [], address: null, city: null, country: "CN", nationalityCountry: null, programCodes: ["MEU"], remarks: null, sourceList: "MEU_LIST", publicationStatus: "PUBLISHED", publishedAt: new Date("2024-01-01"), supersededAt: null, sourcePublishedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01") },
        ];
        const sl = args?.where?.sourceList;
        if (!sl) return Promise.resolve(rows);
        const wanted = typeof sl === "string" ? [sl] : sl.in ?? [];
        return Promise.resolve(rows.filter((r) => wanted.includes(r.sourceList)));
      }),
    },
    complianceKeywordRule: {
      // Mirrors embargoRule's args-aware mock: filters by category so
      // End-Use/Anti-Boycott/Military-End-Use checks can genuinely run
      // (and resolve CLEAR) in tests that supply benign statement/document
      // text, without ever matching that text by accident.
      findMany: vi.fn().mockImplementation((args?: { where?: { category?: string | { in?: string[] } } }) => {
        const rows = [
          { id: "ck_nuclear", category: "END_USE_NUCLEAR", phrase: "uranium enrichment", matchType: "CONTAINS", citation: "15 CFR 744.2", severity: "CRITICAL", authority: "US BIS / Dept of Commerce", publicationStatus: "PUBLISHED", publishedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01") },
          { id: "ck_military", category: "MILITARY_END_USE", phrase: "military aircraft maintenance", matchType: "CONTAINS", citation: "15 CFR 744.21", severity: "CRITICAL", authority: "US BIS / Dept of Commerce", publicationStatus: "PUBLISHED", publishedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01") },
          { id: "ck_boycott", category: "ANTI_BOYCOTT_REQUEST", phrase: "goods not of Israeli origin", matchType: "CONTAINS", citation: "15 CFR 760.2", severity: "HIGH", authority: "US BIS / Dept of Commerce", publicationStatus: "PUBLISHED", publishedAt: new Date("2024-01-01"), createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01") },
        ];
        const cat = args?.where?.category;
        if (!cat) return Promise.resolve(rows);
        const wanted = typeof cat === "string" ? [cat] : cat.in ?? [];
        return Promise.resolve(rows.filter((r) => wanted.includes(r.category)));
      }),
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

  it("Agent 5 (Origin Rules): flags a USMCA-territory line as a candidate requiring human substantiation, never an auto-approved claim", async () => {
    // Country of manufacture alone used to be enough to claim SPI "S",
    // Criterion B, and a passed tariff shift with status AUTO_VERIFIED --
    // with no product-specific rule, bill of materials, or supplier evidence
    // behind it. This agent has none of that evidence, so it must never
    // substantiate the claim itself.
    const res = await OriginRulesAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", manufacturingCountry: "MX" }],
    });
    expect(res.qualifications[0].ftaProgram).toBe("USMCA_CANDIDATE");
    expect(res.qualifications[0].spiCode).toBe("");
    expect(res.qualifications[0].tariffShiftMet).toBeNull();
    expect(res.qualifications[0].preferenceCriterion).not.toBe("B");
    // Entered value and the HTS-specific rate are not available to this agent,
    // so no saving can be computed. It used to report a flat $3,007 per line.
    expect(res.qualifications[0].estimatedSavings).toBeNull();
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 5 (Origin Rules): never auto-verifies a USMCA candidate line", async () => {
    await OriginRulesAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", manufacturingCountry: "CA" }],
    });
    const createCall = vi.mocked(db.agentDecision.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.triageState).toBe("NEEDS_REVIEW");
    expect(createCall.data.status).toBe("Needs Review");
    expect(createCall.data.autoApprovalPolicy).toBeUndefined();
  });

  it("Agent 5 (Origin Rules): auto-verifies a non-FTA origin line, since no preference is being claimed", async () => {
    const res = await OriginRulesAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "8481.80.1050", manufacturingCountry: "CN" }],
    });
    expect(res.qualifications[0].ftaProgram).toBe("NONE");
    const createCall = vi.mocked(db.agentDecision.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.triageState).toBe("AUTO_VERIFIED");
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
      shipFromCountry: "MX",
      lineItems: [{ lineNumber: 1, htsCode: "7318.15.2065", countryOfOrigin: "MX" }],
      supplierName: "Shenzhen Precision Hardware Corp",
      // Benign text so Phase 2's End-Use/Anti-Boycott/Military-End-Use keyword
      // checks genuinely run (against the mocked reference data) and resolve
      // CLEAR, rather than SKIPPED for lack of input -- this test asserts a
      // real, fully-screened clear result across every capability, not just UFLPA.
      endUseStatement: "General industrial machinery parts for commercial assembly.",
      documentNarrativeText: "Standard purchase order terms, no boycott-related language.",
    });
    expect(res.riskScore).toBe(0);
    expect(res.uflpaCleared).toBe(true);
    // A genuine CLEAR (every screening capability ran and found nothing) does
    // not fabricate a "passed" audit entry per line -- absence of a
    // SCREENING_GAP finding is what proves every screening actually executed.
    expect(res.auditResults.find((r) => r.category === "SCREENING_GAP")).toBeUndefined();
    expect(res.auditChecksPassed).toBe(res.auditChecksRun);
    expect(res.agentDecisionId).toBeDefined();
  });

  it("Agent 7 (Compliance Audit): flags a UFLPA-regime-origin line even when other lines are clean", async () => {
    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [
        { lineNumber: 1, htsCode: "7318.15.2065", countryOfOrigin: "MX" },
        { lineNumber: 2, htsCode: "8481.80.5090", countryOfOrigin: "China (Xinjiang)" },
      ],
    });
    expect(res.riskScore).toBeGreaterThan(0);
    expect(res.uflpaCleared).toBe(false);
    expect(res.status).toBe("Review Required");
    const line2Finding = res.auditResults.find((r) => r.lineNumber === 2 && r.category === "UFLPA");
    expect(line2Finding?.passed).toBe(false);
    expect(line2Finding?.details).toContain("China (Xinjiang)");
  });

  it("Agent 7 (Compliance Audit): does not mislabel a non-UFLPA comprehensive-sanctions origin as a UFLPA finding", async () => {
    // Regression guard for a real bug: the old inline check matched a line's
    // origin against every loaded EmbargoRule row (comprehensive sanctions
    // included) under a rule literally named "UFLPA Forced Labor & Sanctions
    // Country Check" -- a plain sanctions hit could be mislabeled as UFLPA.
    const res = await ComplianceAuditAgent.execute({
      accountId: "acc_1",
      userId: "usr_1",
      shipmentId: "shp_1",
      lineItems: [{ lineNumber: 1, htsCode: "8481.80.5090", countryOfOrigin: "KP" }],
    });
    expect(res.auditResults.find((r) => r.lineNumber === 1 && r.category === "UFLPA")).toBeUndefined();
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
    // Two independent db.embargoRule.findMany calls happen per execution now
    // (the general fetch, and forcedLaborRepository's UFLPA-regime-filtered
    // fetch) -- queue an empty result for both, then fall back to the shared
    // default mock implementation for any later test.
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

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
    // With no rules loaded, no UFLPA match/no-match finding should be
    // fabricated for the line -- only an honest "did not run" gap signal.
    const uflpaFinding = res.auditResults.find((r) => r.category === "UFLPA");
    expect(uflpaFinding?.ruleId).toBe("RULE-SCREENING-GAP-04");
    expect(uflpaFinding?.details).toContain("did not run");
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
