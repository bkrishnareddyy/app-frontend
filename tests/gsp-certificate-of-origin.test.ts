import { describe, it, expect, vi } from "vitest";

// Mock DB and audit calls to avoid hitting Supabase session connection limits in unit tests
vi.mock("@/lib/db", () => ({
  db: {
    account: {
      upsert: vi.fn().mockResolvedValue({ id: "acc_test_gsp" }),
    },
    user: {
      upsert: vi.fn().mockResolvedValue({ id: "user_test_gsp" }),
    },
    shipment: {
      upsert: vi.fn().mockResolvedValue({ id: "shp_test_gsp" }),
    },
    shipmentDocument: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `doc_${Date.now()}`, ...data })),
    },
    agentDecision: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `dec_${Date.now()}`, ...data })),
    },
    hTSCode: {
      findMany: vi.fn().mockResolvedValue([
        { htsCode10: "7318.15.2065", description: "Screws and bolts of stainless steel" },
      ]),
    },
    customsFiling: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `filing_${Date.now()}`, ...data })),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit_gsp" }),
}));

import { DocumentTypeCatalog } from "@/modules/intake/documentTypeCatalog";
import { AgentOrchestrator } from "@/modules/agents/agentOrchestrator";
import { OriginRulesAgent } from "@/modules/agents/originRulesAgent";
import { ComplianceAuditAgent } from "@/modules/agents/complianceAuditAgent";

describe("GSP Form A Certificate of Origin Zero-Hallucination Pipeline", () => {
  const accountId = "acc_test_gsp";
  const userId = "user_test_gsp";
  const shipmentId = "shp_test_gsp";

  it("correctly classifies GSP Form A Certificate of Origin document type", () => {
    const catalogMatch = DocumentTypeCatalog.matchDocumentType("Form A Generalized System of Preferences Certificate of Origin");
    expect(catalogMatch.code).toBe("GENERAL_CERTIFICATE_OF_ORIGIN");
    expect(catalogMatch.name).toContain("Certificate of Origin");
  });

  it("executes canonical shipment state & enterprise 9.5+ production contract", async () => {
    const output = await AgentOrchestrator.runFullPipeline({
      accountId,
      userId,
      shipmentId,
      fileName: "Form_A_GSP_Certificate_of_Origin.png",
    });

    const agent1 = output.agentResults.agent1_intake;
    const agent2 = output.agentResults.agent2_intelligence;
    const agent6 = output.agentResults.agent6_valuation;
    const agent8 = output.agentResults.agent8_readiness;
    const agent9 = output.agentResults.agent9_filing;
    const agent10 = output.agentResults.agent10_response;

    // Canonical Shipment State
    expect(output.canonicalShipmentState).toBeDefined();
    expect(output.canonicalShipmentState.lifecycleStatus).toBe("BLOCKED");
    expect(output.canonicalShipmentState.userActionStatus).toBe("ACTION_REQUIRED");
    expect(output.canonicalShipmentState.completeness.score).toBe(20);

    // Summary Math Identity: completed + blocked + skipped === 10
    const { completed, blocked, skipped, total } = output.agentsSummary;
    expect(total).toBe(10);
    expect(completed + blocked + skipped).toBe(10);

    // Blocker Ownership vs Dependency Mapping
    expect(output.readiness.blockers.length).toBeGreaterThan(0);
    const invoiceBlocker = output.readiness.blockers.find((b) => b.code === "MISSING_COMMERCIAL_INVOICE");
    expect(invoiceBlocker).toBeDefined();
    expect(invoiceBlocker?.ownerAgent).toBe("Document Intelligence Agent");
    expect(invoiceBlocker?.causedBy).toContain("Commercial Invoice document missing from packet");

    // Actionable Human Task with requiredFields
    expect(output.humanReviewTask).toBeDefined();
    expect(output.humanReviewTask?.requiredFields.length).toBeGreaterThan(0);
    const invoiceReq = output.humanReviewTask?.requiredFields.find((f) => f.field === "commercialInvoice");
    expect(invoiceReq).toBeDefined();

    // Agent 1: Classification check
    expect(agent1.classifications[0]?.docTypeCode).toBe("GENERAL_CERTIFICATE_OF_ORIGIN");

    // Agent 2: Separated Document Detection vs Validation
    expect(agent2.detectedDocType).toBe("GENERAL_CERTIFICATE_OF_ORIGIN");
    expect(agent2.isValidCommercialInvoice).toBe(false);

    // Agent 6: Calibrated Valuation Confidence
    expect(agent6.enteredCustomsValue).toBeNull();
    expect(agent6.status).toBe("Skipped - Missing Invoice Data");
    expect(agent6.confidenceMetrics.decisionConfidence).toBe(100);
    expect(agent6.confidenceMetrics.valuationConfidence).toBe(0);

    // Agent 8: Detailed Missing Requirements
    expect(agent8.missingRequirementsDetails.length).toBeGreaterThan(0);

    // Agent 9 & 10: Filing & Response Status
    expect(agent8.readyForTransmission).toBe(false);
    expect(agent9.aceResponse.status).toBe("BLOCKED");
    expect(agent10.status).toBe("COMPLETED_NO_ACTION");
  });

  it("enforces prerequisite gating: Agent 5 (Origin Rules) STOPS with 0% confidence when origin is null", async () => {
    const originRes = await OriginRulesAgent.execute({
      accountId,
      userId,
      shipmentId,
      lineItems: [],
    });

    expect(originRes.status).toBe("BLOCKED_DEPENDENCY");
    expect(originRes.confidence).toBe(0);
    expect(originRes.qualifications).toHaveLength(0);
    expect(originRes.blockingReasons).toContain("Country of origin missing or unverified");

    const complianceRes = await ComplianceAuditAgent.execute({
      accountId,
      userId,
      shipmentId,
      htsCode: undefined,
      countryOfOrigin: null,
      isHtsBlocked: true,
    });

    expect(complianceRes.status).toBe("BLOCKED_DEPENDENCY");
    expect(complianceRes.riskScore).toBeNull();
    expect(complianceRes.auditChecksRun).toBe(0);
  });
});
