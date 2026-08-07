import { describe, it, expect, vi } from "vitest";
import { NormalizationAgent } from "../src/modules/agents/normalizationAgent";

vi.mock("../src/lib/db", () => ({
  db: {
    agentDecision: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: `dec_${Date.now()}`, ...data })),
    },
  },
}));

vi.mock("../src/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit_123" }),
}));

describe("Business Intelligence Normalization Agent Test Suite", () => {
  it("should normalize structured JSON from Document Intelligence Agent into Canonical Enterprise Model", async () => {
    const mockDocIntelOutput = {
      packetId: "pkt_test_99",
      shipmentId: "shp_test_99",
      fileName: "Commercial_Invoice_INV-88421.pdf",
      exporterName: "Shenzhen Precision Hardware Corp",
      importerName: "ABC Manufacturing LLC",
      originCountry: "CN",
      destinationCountry: "US",
      currency: "USD",
      invoiceSubtotal: 48500.0,
      incoterm: "FOB SHENZHEN",
      midCode: "CNSHEPRE123SHE",
      lineItems: [
        {
          lineNumber: 1,
          sku: "SKU-992-FAST",
          description: "Stainless Steel Fasteners 1/4-20",
          quantity: 10000,
          unitPrice: 4.85,
          totalAmount: 48500.0,
          unitOfMeasure: "PCS",
          countryOfOrigin: "CN",
        },
      ],
      validationFailures: [],
    };

    const res = await NormalizationAgent.execute({
      accountId: "acc_test",
      userId: "usr_test",
      shipmentId: "shp_test_99",
      documentIntelligenceData: mockDocIntelOutput,
    });

    expect(res.status).toBe("Completed");
    expect(res.canonicalModel).toBeDefined();
    expect(res.canonicalModel.parties.length).toBeGreaterThanOrEqual(2);
    expect(res.canonicalModel.products.length).toBe(1);
    expect(res.canonicalModel.financials).toBeDefined();
    expect(res.canonicalModel.audit.agentName).toBe("Business Intelligence Normalization Agent");
    expect(res.reasoningChain).toContain("Normalized document intelligence into canonical enterprise model");
  });
});
