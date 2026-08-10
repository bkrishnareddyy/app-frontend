import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database & audit log calls
vi.mock("../src/lib/db", () => ({
  db: {
    shipmentDocument: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: `doc_${Date.now()}`,
        ...data,
      })),
    },
    agentDecision: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: `dec_${Date.now()}`,
        ...data,
      })),
    },
  },
}));

vi.mock("../src/lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit_123" }),
}));

import { DocumentIntakeAgent, agentEventBus } from "../src/modules/intake/documentIntakeAgent";

describe("Agent 1: Document Intake Agent (AI Vision & Reactive Bus) Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute autonomous Document Intake Agent and generate an approved AgentDecision", async () => {
    const result = await DocumentIntakeAgent.execute({
      accountId: "acc_test_123",
      userId: "usr_test_123",
      shipmentId: "shp_test_123",
      fileName: "Commercial_Invoice_INV-994.pdf",
      fileUrl: "https://storage.qubere.ai/docs/inv-994.pdf",
      fileBuffer: Buffer.from("%PDF-1.4 Mock Commercial Invoice Content"),
      docTypeOverride: "COMMERCIAL_INVOICE",
    });

    expect(result.packetId).toContain("pkt_");
    expect(result.shipmentId).toBe("shp_test_123");
    expect(result.detectedTypes).toContain("COMMERCIAL_INVOICE");
    expect(result.missingRequiredDocs).toHaveLength(0);
    // No vision provider runs in tests, so the packet is classified from the filename
    // alone. That carries no OCR confidence and must not clear the automated-filing gate.
    expect(result.overallConfidence).toBeNull();
    expect(result.status).toBe("Review Required");
    expect(result.agentDecisionId).toBeDefined();
    expect(result.reasoningChain).toBeDefined();
    expect(result.aiProviderUsed).toBeDefined();
  });

  it("should classify Bill of Lading files correctly when docTypeOverride or vision is passed", async () => {
    const result = await DocumentIntakeAgent.execute({
      accountId: "acc_test_123",
      userId: "usr_test_123",
      shipmentId: "shp_test_123",
      fileName: "Master_Bill_of_Lading_BL882.pdf",
      fileUrl: "https://storage.qubere.ai/docs/bl882.pdf",
      docTypeOverride: "OCEAN_BILL_OF_LADING",
    });

    expect(result.detectedTypes).toContain("OCEAN_BILL_OF_LADING");
    expect(result.classifications[0].docTypeCode).toBe("OCEAN_BILL_OF_LADING");
  });

  it("should respect explicit docTypeOverride parameters", async () => {
    const result = await DocumentIntakeAgent.execute({
      accountId: "acc_test_123",
      userId: "usr_test_123",
      shipmentId: "shp_test_123",
      fileName: "scan_document_12.pdf",
      fileUrl: "https://storage.qubere.ai/docs/scan12.pdf",
      docTypeOverride: "CERTIFICATE_OF_ORIGIN",
    });

    expect(result.detectedTypes).toContain("GENERAL_CERTIFICATE_OF_ORIGIN");
    expect(result.classifications[0].docTypeCode).toBe("GENERAL_CERTIFICATE_OF_ORIGIN");
  });

  it("should trigger human broker review when missing required Commercial Invoice", async () => {
    const result = await DocumentIntakeAgent.execute({
      accountId: "acc_test_123",
      userId: "usr_test_123",
      shipmentId: "shp_test_123",
      fileName: "Packing_List_Only.pdf",
      fileUrl: "https://storage.qubere.ai/docs/pack.pdf",
      docTypeOverride: "PACKING_LIST",
    });

    expect(result.missingRequiredDocs).toContain("COMMERCIAL_INVOICE");
    expect(result.status).toBe("Review Required");
    expect(result.humanReviewReason).toContain("Missing mandatory trade documents");
  });

  it("should emit intake:completed event to wake up downstream agents in multi-agent pipeline", async () => {
    const eventHandler = vi.fn();
    agentEventBus.once("intake:completed", eventHandler);

    const result = await DocumentIntakeAgent.execute({
      accountId: "acc_test_123",
      userId: "usr_test_123",
      shipmentId: "shp_test_123",
      fileName: "Commercial_Invoice_INV-994.pdf",
      fileUrl: "https://storage.qubere.ai/docs/inv-994.pdf",
    });

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining({ packetId: result.packetId }));
  });
});
