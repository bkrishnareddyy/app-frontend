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
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `doc_${Date.now()}`,
        ...data,
      })),
    },
    agentDecision: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `dec_${Date.now()}`,
        ...data,
      })),
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
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `filing_${Date.now()}`,
        ...data,
      })),
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

/** Agent outputs are optional now that a halted run reports what it never ran. */
function required<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error(`${name} missing from pipeline output`);
  return value;
}

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
      fileName: "Form_A_GSP_Certificate_of_Origin.pdf",
      fileUrl: "https://example.blob.core.windows.net/docs/form-a-gsp.pdf",
      docTypeOverride: "GENERAL_CERTIFICATE_OF_ORIGIN",
    });

    // Blocked is not halted: every agent ran here and reported its own block.
    expect(output.haltedAgents).toEqual([]);

    const agent1 = required(output.agentResults.agent1_intake, "agent1_intake");
    const agent2 = required(output.agentResults.agent2_intelligence, "agent2_intelligence");
    const agent6 = required(output.agentResults.agent6_valuation, "agent6_valuation");
    const agent8 = required(output.agentResults.agent8_readiness, "agent8_readiness");
    const agent9 = required(output.agentResults.agent9_filing, "agent9_filing");
    const agent10 = required(output.agentResults.agent10_response, "agent10_response");
    const canonical = required(output.canonicalShipmentState, "canonicalShipmentState");
    const readiness = required(output.readiness, "readiness");

    // Canonical Shipment State
    expect(canonical.lifecycleStatus).toBe("BLOCKED");
    expect(canonical.userActionStatus).toBe("ACTION_REQUIRED");
    expect(canonical.completeness.score).toBe(20);

    // Summary Math Identity: completed + blocked + skipped === 10
    const { completed, blocked, skipped, total } = output.agentsSummary;
    expect(total).toBe(10);
    expect(completed + blocked + skipped).toBe(10);

    // Blocker Ownership vs Dependency Mapping
    expect(readiness.blockers.length).toBeGreaterThan(0);
    const invoiceBlocker = readiness.blockers.find((b) => b.code === "MISSING_COMMERCIAL_INVOICE");
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
