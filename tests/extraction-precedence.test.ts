import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * One upload can produce two extractions of the same document: a vision pass over
 * the raw image (upload pipeline) and a pass over a parsed document context
 * (document worker, once a parse is accepted). Both write `extractedJson`.
 *
 * These tests pin the rule that decides which one survives, in BOTH arrival
 * orders -- the bug being guarded against is "whichever finished last wins",
 * which made the value a broker sees non-deterministic.
 */

const dbMock = {
  shipmentDocument: { findFirst: vi.fn(), updateMany: vi.fn() },
  documentParseVersion: { create: vi.fn() },
  agentDecision: { create: vi.fn() },
  auditLog: { create: vi.fn() },
};

const assignParty = vi.fn();
const syncExceptions = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn() }));
vi.mock("@/modules/entity/entityResolutionService", () => ({
  EntityResolutionService: { findOrCreateEntity: vi.fn(async () => ({ id: "ent_1" })) },
}));
vi.mock("@/modules/shipment/shipmentPartyService", () => ({
  ShipmentPartyService: { assignParty: (p: unknown) => assignParty(p) },
}));
vi.mock("@/modules/exceptions/exception.service", () => ({
  ExceptionService: { syncDocumentFieldExceptions: (p: unknown) => syncExceptions(p) },
}));

const { DocumentIntelligenceAgent } = await import("@/modules/agents/documentIntelligenceAgent");

const ACCOUNT = "acct_1";
const SHIPMENT = "shp_1";
const DOCUMENT = "doc_1";

function baseInput() {
  return {
    accountId: ACCOUNT,
    userId: "u_1",
    shipmentId: SHIPMENT,
    packetId: "pkt_1",
    fileName: "INV-1.pdf",
  };
}

/** The context a worker run supplies after a parse has been accepted. */
const PARSED_CONTEXT = {
  text: "--- SECTION chk_1 [Invoice] (page 1) ---\nInvoice No: INV-1",
  processingRunId: "run_1",
  parserProvider: "IBM_DOCLING",
  parserProfile: "STANDARD",
  contextSchemaVersion: "QubereDocumentContextV1",
  truncated: false,
};

/** The condition the UPDATE carried, or undefined when it was unconditional. */
function writeGuard(): unknown {
  return dbMock.shipmentDocument.updateMany.mock.calls[0]?.[0]?.where?.activeParseVersionId;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GEMINI_API_KEY; // no model call; the persistence path is under test
  dbMock.shipmentDocument.findFirst.mockResolvedValue({
    id: DOCUMENT,
    fileName: "INV-1.pdf",
    parseVersions: [],
  });
  dbMock.shipmentDocument.updateMany.mockResolvedValue({ count: 1 });
  dbMock.documentParseVersion.create.mockResolvedValue({ id: "pv_1" });
  dbMock.agentDecision.create.mockResolvedValue({ id: "dec_1" });
});

describe("extraction write precedence", () => {
  it("guards a background vision write on no parse having been accepted", async () => {
    await DocumentIntelligenceAgent.execute(baseInput());

    // The guard is part of the UPDATE, not a prior read: two concurrent runs
    // must not both observe "no parse yet" and then both write.
    expect(writeGuard()).toBeNull();
    expect(dbMock.shipmentDocument.updateMany).toHaveBeenCalledTimes(1);
  });

  it("lets a context-backed write proceed unconditionally", async () => {
    await DocumentIntelligenceAgent.execute({ ...baseInput(), documentContext: PARSED_CONTEXT });

    // No condition: an extraction carrying provenance always supersedes.
    expect(writeGuard()).toBeUndefined();
  });

  it("lets an explicitly requested re-extraction overwrite a parse-derived one", async () => {
    await DocumentIntelligenceAgent.execute({ ...baseInput(), forceOverwrite: true });
    expect(writeGuard()).toBeUndefined();
  });

  it("does not apply parties or exceptions when its write lost", async () => {
    // count 0 == the guard matched nothing: a parse-derived extraction already
    // exists, so this vision reading was discarded.
    dbMock.shipmentDocument.updateMany.mockResolvedValue({ count: 0 });

    await DocumentIntelligenceAgent.execute(baseInput());

    // The losing reading must not reach the shipment by another route, or the
    // document would show one set of values and the exceptions another.
    expect(assignParty).not.toHaveBeenCalled();
    expect(syncExceptions).not.toHaveBeenCalled();
  });

  it("applies parties and exceptions when its write won", async () => {
    dbMock.shipmentDocument.updateMany.mockResolvedValue({ count: 1 });
    await DocumentIntelligenceAgent.execute({ ...baseInput(), documentContext: PARSED_CONTEXT });
    expect(syncExceptions).toHaveBeenCalled();
  });

  it("still records the run that happened, even when its write lost", async () => {
    dbMock.shipmentDocument.updateMany.mockResolvedValue({ count: 0 });
    await DocumentIntelligenceAgent.execute(baseInput());

    // The discarded run is still history worth keeping, attributed to the engine
    // that produced it.
    expect(dbMock.documentParseVersion.create).toHaveBeenCalled();
    expect(dbMock.documentParseVersion.create.mock.calls[0][0].data.parserProvider).toBe(
      "GEMINI_VISION"
    );
  });

  it("distinguishes a run over parsed context from a run over the image", async () => {
    // This agent runs twice per upload, once each way. Labelling both
    // GEMINI_VISION left two rows nothing could tell apart -- including their
    // stored confidence, which describes a different act of reading in each case.
    dbMock.shipmentDocument.updateMany.mockResolvedValue({ count: 1 });
    await DocumentIntelligenceAgent.execute({ ...baseInput(), documentContext: PARSED_CONTEXT });

    const data = dbMock.documentParseVersion.create.mock.calls[0][0].data;
    expect(data.parserProvider).toBe("GEMINI_PARSED_CONTEXT");
    // And which parser produced that context, so the lineage is traceable.
    expect(data.parserName).toBe("IBM_DOCLING");
  });

  it("records no upstream parser for a run that read the image", async () => {
    dbMock.shipmentDocument.updateMany.mockResolvedValue({ count: 1 });
    await DocumentIntelligenceAgent.execute(baseInput());

    const data = dbMock.documentParseVersion.create.mock.calls[0][0].data;
    expect(data.parserProvider).toBe("GEMINI_VISION");
    // No parser stood between the model and the page, and naming one would be
    // a lineage claim that never happened.
    expect(data.parserName).toBeNull();
  });

  it("never writes the document row with an unconditional update", async () => {
    // `update` cannot express the guard, so its presence would reintroduce the
    // race even if the guard exists elsewhere.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../src/modules/agents/documentIntelligenceAgent.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/db\.shipmentDocument\.update\(/);
    expect(source).toMatch(/db\.shipmentDocument\.updateMany\(/);
  });
});
