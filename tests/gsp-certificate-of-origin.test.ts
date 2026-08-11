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

  // The full-pipeline "canonical shipment state & production contract" case
  // that used to live here tested ComplianceWorkflowEngine's in-memory
  // report assembly (blockers[], humanReviewTask, canonicalShipmentState).
  // That subsystem is gone: PipelineOrchestrator persists straight to
  // Postgres (Fact, ShipmentLineItem, ExceptionItem) and the canonical view
  // is read back via CanonicalShipmentService, not reconstructed from an
  // in-memory AgentState. Covered instead by the plan's end-to-end
  // verification against a running dev server + real DB, not a deep mock.

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
      lineItems: [],
      isHtsBlocked: true,
    });

    expect(complianceRes.status).toBe("BLOCKED_DEPENDENCY");
    expect(complianceRes.riskScore).toBeNull();
    expect(complianceRes.auditChecksRun).toBe(0);
  });
});
