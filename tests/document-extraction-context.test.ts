import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Extraction reads a QubereDocumentContextV1, not raw parser JSON and not the raw
 * bytes when a parse exists, and it is recorded as its own versioned run so the
 * agent's reading of a parse is separable from the parse itself.
 */

const dbMock = {
  shipmentDocument: { findFirst: vi.fn() },
  documentParseVersion: { findFirst: vi.fn() },
  agentExecutionRecord: { create: vi.fn(), update: vi.fn() },
};

const auditEvents: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
const agentInputs: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({
  createAuditLog: async (params: { action: string; metadata?: Record<string, unknown> }) => {
    auditEvents.push(params);
    return null;
  },
}));
vi.mock("@/modules/agents/documentIntelligenceAgent", () => ({
  DocumentIntelligenceAgent: {
    execute: async (input: Record<string, unknown>) => {
      agentInputs.push(input);
      return {
        extractionStatus: "success",
        detectedDocType: "COMMERCIAL_INVOICE",
        lineItems: [{ lineNumber: 1, description: "Valve", quantity: 10, unitPrice: 5, totalAmount: 50 }],
        missingFields: [],
        extractionError: undefined,
      };
    },
  },
}));

const NORMALIZED = {
  contractVersion: "qubere.parser/1",
  profile: "STANDARD",
  metadata: {
    provider: "IBM_DOCLING",
    parserName: "DoclingDocument",
    parserVersion: "1.3.0",
    ocrEngine: null,
    ocrEngineVersion: null,
    pageCount: 1,
    ocrUsed: null,
    fullPageOcrUsed: null,
    processingDurationMs: 1000,
    parserConfidence: null,
    ocrConfidence: null,
  },
  markdown: "# Invoice",
  sections: [
    {
      id: "sec_0000_abc",
      headingPath: ["COMMERCIAL INVOICE"],
      content: "Invoice No: INV-1\nShipper: ACME GmbH",
      provenance: [{ page: 1, bbox: null, elementRef: "#/texts/0" }],
    },
  ],
  tables: [],
  warnings: [],
  pageTextLengths: [120],
};

vi.mock("@/modules/documents/parser/artifactStore", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/documents/parser/artifactStore")
  >("@/modules/documents/parser/artifactStore");
  return {
    ...actual,
    loadNormalizedResult: async () => NORMALIZED,
  };
});

const extraction = await import("@/modules/documents/processing/classificationExtraction");

const ACCOUNT = "acct_1";
const DOCUMENT = "doc_1";

const ARTIFACT_INDEX = {
  contractVersion: "qubere.parser/1",
  artifacts: [
    {
      artifactType: "NORMALIZED_JSON",
      storageRef: "https://store.public.blob.vercel-storage.com/parser-normalized.json",
      mimeType: "application/json",
      byteSize: 100,
      sha256: "e".repeat(64),
      schemaVersion: "qubere.parser/1",
      tableId: null,
      createdAt: new Date().toISOString(),
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  auditEvents.length = 0;
  agentInputs.length = 0;

  dbMock.shipmentDocument.findFirst.mockResolvedValue({
    id: DOCUMENT,
    fileName: "INV-1.pdf",
    docType: "Commercial Invoice",
    activeParseVersionId: "run_1",
  });
  dbMock.documentParseVersion.findFirst.mockResolvedValue({
    id: "run_1",
    status: "SUCCEEDED",
    artifactsJson: ARTIFACT_INDEX,
    profile: "STANDARD",
  });
  dbMock.agentExecutionRecord.create.mockResolvedValue({ id: "exec_1" });
  dbMock.agentExecutionRecord.update.mockResolvedValue({});
});

describe("extraction over a parsed context", () => {
  it("hands the agent a rendered context instead of the document bytes", async () => {
    const result = await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: "u_1",
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: "corr_1",
      processingRunId: "run_1",
    });

    expect(result.ran).toBe(true);
    expect(result.usedParsedContext).toBe(true);

    const input = agentInputs[0];
    expect(input.fileBuffer).toBeUndefined();
    const context = input.documentContext as Record<string, unknown>;
    expect(context.parserProvider).toBe("IBM_DOCLING");
    expect(context.contextSchemaVersion).toBe("QubereDocumentContextV1");
    expect(String(context.text)).toContain("Invoice No: INV-1");
    // Stable ids reach the prompt, so the model can cite where a value came from.
    expect(String(context.text)).toContain("sec_0000_abc");
  });

  it("passes a missing actor through as null rather than a sentinel string", async () => {
    // A worker run has no human actor. AuditLog.userId is a foreign key to User,
    // so substituting a placeholder like "SYSTEM" makes every audit write for a
    // background parse fail the constraint — losing the audit trail on exactly
    // the runs nobody watched.
    await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: null,
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: "corr_1",
      processingRunId: "run_1",
    });

    expect(agentInputs[0].userId).toBeNull();
  });

  it("never puts the vendor payload or a storage location in the prompt", async () => {
    await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: "u_1",
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: "corr_1",
      processingRunId: "run_1",
    });
    const text = String((agentInputs[0].documentContext as { text: string }).text);
    expect(text).not.toContain("json_content");
    expect(text).not.toContain("blob.vercel-storage.com");
    expect(text).not.toContain(ACCOUNT);
  });

  it("records the extraction as its own versioned run, separate from the parse", async () => {
    await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: "u_1",
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: "corr_1",
      processingRunId: "run_1",
    });

    // Written as RUNNING before execution, so a crash leaves a record rather than none.
    const created = dbMock.agentExecutionRecord.create.mock.calls[0][0].data;
    expect(created.status).toBe("RUNNING");
    expect(created.agentName).toBe("Document Intelligence Agent");
    expect(created.triggerEvent).toBe("DOCUMENT_READY_FOR_CLASSIFICATION");

    expect(dbMock.agentExecutionRecord.update.mock.calls[0][0].data.status).toBe("COMPLETED");
    // The parse itself is untouched by extraction.
    expect(dbMock.documentParseVersion.findFirst).toHaveBeenCalled();
  });

  it("audits which parse, prompt contract and extractor version produced the facts", async () => {
    await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: "u_1",
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: "corr_1",
      processingRunId: "run_1",
    });

    const audit = auditEvents.find((event) => event.action === "document.extraction.completed");
    expect(audit?.metadata?.processingRunId).toBe("run_1");
    expect(audit?.metadata?.extractionSchemaVersion).toBe(extraction.EXTRACTION_SCHEMA_VERSION);
    expect(audit?.metadata?.contextSchemaVersion).toBe("QubereDocumentContextV1");
    expect(audit?.metadata?.parserProvider).toBe("IBM_DOCLING");
    expect(audit?.metadata?.contextTruncated).toBe(false);
  });

  it("does not run at all when the document has no accepted parse", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue({
      id: DOCUMENT,
      fileName: "INV-1.pdf",
      docType: "Commercial Invoice",
      activeParseVersionId: null,
    });

    const result = await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: null,
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: null,
      processingRunId: null,
    });

    // Guessing at a document nobody has read is how fabricated customs facts appear.
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toMatch(/no accepted parse/);
    expect(agentInputs).toHaveLength(0);
    expect(dbMock.agentExecutionRecord.create).not.toHaveBeenCalled();
  });

  it("does not run when the parse stored no artifacts", async () => {
    dbMock.documentParseVersion.findFirst.mockResolvedValue({
      id: "run_1",
      status: "NEEDS_REVIEW",
      artifactsJson: null,
      profile: "STANDARD",
    });

    const result = await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: null,
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: null,
      processingRunId: "run_1",
    });
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toMatch(/no parser artifacts/);
  });

  it("reads the document only through the caller's tenant", async () => {
    await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: null,
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: null,
      processingRunId: "run_1",
    });
    expect(dbMock.shipmentDocument.findFirst.mock.calls[0][0].where).toEqual({
      id: DOCUMENT,
      accountId: ACCOUNT,
    });
  });

  it("marks the run FAILED and audits it when the agent throws", async () => {
    const agent = await import("@/modules/agents/documentIntelligenceAgent");
    vi.spyOn(agent.DocumentIntelligenceAgent, "execute").mockRejectedValue(new Error("model down"));

    const result = await extraction.runDocumentExtraction({
      accountId: ACCOUNT,
      userId: "u_1",
      documentId: DOCUMENT,
      shipmentId: "shp_1",
      correlationId: "corr_1",
      processingRunId: "run_1",
    });

    expect(result.ran).toBe(true);
    expect(result.skippedReason).toBe("model down");
    expect(dbMock.agentExecutionRecord.update.mock.calls[0][0].data.status).toBe("FAILED");
    expect(auditEvents.some((event) => event.action === "document.extraction.failed")).toBe(true);
  });
});
