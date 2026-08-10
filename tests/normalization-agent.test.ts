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

  it("reports no confidence when the deterministic mapper transcribed the fields", async () => {
    // Without GEMINI_API_KEY no model runs, so nothing has scored these values.
    const res = await NormalizationAgent.execute({
      accountId: "acc_test",
      userId: "usr_test",
      shipmentId: "shp_test_100",
      documentIntelligenceData: {
        exporterName: "Shenzhen Precision Hardware Corp",
        importerName: "ABC Manufacturing LLC",
        currency: "USD",
        invoiceSubtotal: 48500.0,
        lineItems: [{ description: "Stainless Steel Fasteners", quantity: 10, unitPrice: 1.5, totalAmount: 15 }],
      },
    });

    expect(res.aiProviderUsed).toBe("Qubere Deterministic Normalization Engine");
    expect(res.confidence).toBeNull();
    expect(res.canonicalModel.parties[0].name.confidence).toBeNull();
    expect(res.canonicalModel.products[0].description.confidence).toBeNull();
  });

  it("preserves a missing description as missing rather than inventing the source value", async () => {
    const res = await NormalizationAgent.execute({
      accountId: "acc_test",
      userId: "usr_test",
      shipmentId: "shp_test_101",
      documentIntelligenceData: {
        importerName: "ABC Manufacturing LLC",
        lineItems: [{ quantity: 5, unitPrice: 2, totalAmount: 10 }],
      },
    });

    const description = res.canonicalModel.products[0].description;
    expect(description.originalValue).toBeNull();
    expect(description.normalizedValue).toBe("Unspecified Goods");
  });

  it("keeps a real zero quantity rather than dropping it as missing", async () => {
    const res = await NormalizationAgent.execute({
      accountId: "acc_test",
      userId: "usr_test",
      shipmentId: "shp_test_102",
      documentIntelligenceData: {
        importerName: "ABC Manufacturing LLC",
        lineItems: [{ description: "Sample, no charge", quantity: 0, unitPrice: 0, totalAmount: 0 }],
      },
    });

    const product = res.canonicalModel.products[0];
    expect(product.quantity?.normalizedValue).toBe(0);
    expect(product.unitPrice?.normalizedValue).toBe(0);
    expect(product.totalAmount?.normalizedValue).toBe(0);
  });

  it("does not name an unknown source document", async () => {
    // sourceDocument used to fall back to "trade-document.pdf", which is written
    // into the canonical model's audit provenance and the AgentDecision.
    const res = await NormalizationAgent.execute({
      accountId: "acc_test",
      userId: "usr_test",
      shipmentId: "shp_test_103",
      documentIntelligenceData: {
        importerName: "ABC Manufacturing LLC",
        lineItems: [{ description: "Widget", quantity: 1, unitPrice: 1, totalAmount: 1 }],
      },
    });

    expect(res.canonicalModel.audit.sourceDocument).toBeNull();
    expect(res.canonicalModel.document.fileName).toBeNull();
  });

  it("carries the real filename through when one is known", async () => {
    const res = await NormalizationAgent.execute({
      accountId: "acc_test",
      userId: "usr_test",
      shipmentId: "shp_test_104",
      documentIntelligenceData: {
        fileName: "Invoice_INV-771.pdf",
        importerName: "ABC Manufacturing LLC",
        lineItems: [{ description: "Widget", quantity: 1, unitPrice: 1, totalAmount: 1 }],
      },
    });

    expect(res.canonicalModel.audit.sourceDocument).toBe("Invoice_INV-771.pdf");
  });
});
