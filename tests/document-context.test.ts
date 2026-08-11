import { describe, it, expect } from "vitest";
import {
  buildChunks,
  estimateTokens,
  selectWithinBudget,
  CHUNKING_ALGORITHM_VERSION,
} from "@/modules/documents/parser/chunking";
import {
  buildQubereDocumentContext,
  qubereDocumentContextSchema,
  renderContextForPrompt,
  QUBERE_DOCUMENT_CONTEXT_VERSION,
} from "@/modules/documents/context/qubereDocumentContext";
import type { NormalizedParserResult } from "@/modules/documents/parser/contracts";

/**
 * Chunking and context building are what stands between a parser and an agent.
 * The properties that matter: chunk ids are stable, budgets are enforced, and
 * anything the budget left out is reported rather than silently dropped — a model
 * told a truncated document is whole will report missing fields as facts about
 * the document.
 */

function section(id: string, heading: string[], content: string, page: number | null) {
  return {
    id,
    headingPath: heading,
    content,
    provenance: [
      {
        page,
        bbox: page === null ? null : { left: 1, top: 2, right: 3, bottom: 4, coordOrigin: "TOPLEFT" as const },
        elementRef: `#/texts/${id}`,
      },
    ],
  };
}

function lineItemTable(id: string, index: number, page: number, rows: number) {
  const cells = [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 1, isHeader: true, text: "Description", provenance: null },
    { row: 0, column: 1, rowSpan: 1, columnSpan: 1, isHeader: true, text: "Quantity", provenance: null },
  ];
  for (let r = 1; r <= rows; r++) {
    cells.push({
      row: r,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      isHeader: false,
      text: `Part ${r} description`,
      provenance: null,
    });
    cells.push({
      row: r,
      column: 1,
      rowSpan: 1,
      columnSpan: 1,
      isHeader: false,
      text: String(r * 10),
      provenance: null,
    });
  }
  return {
    id,
    index,
    caption: null,
    page,
    bbox: { left: 10, top: 20, right: 30, bottom: 40, coordOrigin: "TOPLEFT" as const },
    rowCount: rows + 1,
    columnCount: 2,
    cells,
    html: "<table></table>",
  };
}

function parsed(overrides: Partial<NormalizedParserResult> = {}): NormalizedParserResult {
  return {
    contractVersion: "qubere.parser/1",
    profile: "STANDARD",
    metadata: {
      provider: "IBM_DOCLING",
      parserName: "DoclingDocument",
      parserVersion: "1.3.0",
      ocrEngine: null,
      ocrEngineVersion: null,
      pageCount: 3,
      ocrUsed: null,
      fullPageOcrUsed: null,
      processingDurationMs: 2500,
      parserConfidence: null,
      ocrConfidence: null,
    },
    markdown: "# Invoice",
    sections: [
      section("sec_a", ["COMMERCIAL INVOICE"], "Invoice No: INV-1\nCurrency: USD\nIncoterm: FOB", 1),
      section("sec_b", ["COMMERCIAL INVOICE", "Parties"], "Shipper: ACME GmbH\nConsignee: Target Imports LLC", 1),
      section("sec_c", ["COMMERCIAL INVOICE", "Notes"], "Delivery instructions follow.", 3),
    ],
    tables: [lineItemTable("tbl_items", 0, 2, 6), lineItemTable("tbl_stamp", 1, 3, 1)],
    warnings: [],
    pageTextLengths: [300, 200, 100],
    ...overrides,
  };
}

const BUDGET = { maxTokens: 24_000, maxBytes: 400_000, maxChunks: 120, maxTables: 30 };

describe("deterministic chunking", () => {
  it("produces identical ids for the same result and algorithm", () => {
    const first = buildChunks(parsed()).map((c) => c.id);
    const second = buildChunks(parsed()).map((c) => c.id);
    expect(second).toEqual(first);
    expect(first.every((id) => id.startsWith("chk_"))).toBe(true);
  });

  it("changes an id when the chunk's content changes", () => {
    const altered = parsed();
    altered.sections[0] = section("sec_a", ["COMMERCIAL INVOICE"], "Invoice No: INV-2", 1);
    expect(buildChunks(altered)[0].id).not.toBe(buildChunks(parsed())[0].id);
  });

  it("declares its algorithm version, so an id change is deliberate", () => {
    expect(CHUNKING_ALGORITHM_VERSION).toBe("qubere.chunk/1");
  });

  it("carries the heading trail and page span onto every chunk", () => {
    const chunks = buildChunks(parsed());
    const parties = chunks.find((c) => c.content.includes("ACME GmbH"));
    expect(parties?.headingPath).toEqual(["COMMERCIAL INVOICE", "Parties"]);
    expect(parties?.pageStart).toBe(1);
    expect(parties?.provenance[0].bbox).not.toBeNull();
  });

  it("keeps a chunk traceable when the parser reported no page", () => {
    const chunks = buildChunks(parsed({ sections: [section("sec_x", [], "orphan text", null)] }));
    expect(chunks[0].pageStart).toBeNull();
    // Absence, not a fabricated page 1.
    expect(chunks[0].provenance[0].page).toBeNull();
  });

  it("renders a table chunk as Markdown with its rows intact", () => {
    const chunks = buildChunks(parsed());
    const table = chunks.find((c) => c.kind === "table");
    expect(table?.content).toContain("Part 1 description");
    expect(table?.pageStart).toBe(2);
  });

  it("splits long text at line boundaries and never mid-value", () => {
    const bigNumber = "1,234,567.89";
    const long = Array.from({ length: 400 }, (_, i) => `Line ${i} value ${bigNumber}`).join("\n");
    const chunks = buildChunks(parsed({ sections: [section("sec_long", [], long, 1)], tables: [] }), {
      maxChunkChars: 500,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Every occurrence of the number survives whole in some chunk.
    const joined = chunks.map((c) => c.content).join("\n");
    expect(joined.split(bigNumber).length - 1).toBe(400);
    for (const chunk of chunks) {
      expect(chunk.content.endsWith(",")).toBe(false);
    }
  });

  it("keeps a single over-long line whole rather than cutting a value in half", () => {
    const singleLine = `Total: ${"9".repeat(900)}`;
    const chunks = buildChunks(parsed({ sections: [section("s", [], singleLine, 1)], tables: [] }), {
      maxChunkChars: 100,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(singleLine);
  });

  it("keeps a heading-only section, because on a form the heading is the datum", () => {
    const chunks = buildChunks(
      parsed({ sections: [section("s", ["CERTIFICATE OF ORIGIN"], "", 1)], tables: [] })
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("CERTIFICATE OF ORIGIN");
  });

  it("estimates tokens conservatively, so a real payload lands under budget", () => {
    // Four characters per token over-counts English prose, which is the safe
    // direction for a ceiling.
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(401))).toBe(101);
  });
});

describe("budgeted selection", () => {
  const chunks = buildChunks(parsed());

  it("admits everything when the budget is ample", () => {
    const selection = selectWithinBudget(chunks, { maxTokens: 1e6, maxBytes: 1e7, maxChunks: 1000 });
    expect(selection.selected).toHaveLength(chunks.length);
    expect(selection.droppedChunkCount).toBe(0);
    expect(selection.limitReached).toBeNull();
  });

  it("reports which limit stopped it and how much it dropped", () => {
    const selection = selectWithinBudget(chunks, { maxTokens: 1e6, maxBytes: 1e7, maxChunks: 2 });
    expect(selection.selected).toHaveLength(2);
    expect(selection.droppedChunkCount).toBe(chunks.length - 2);
    expect(selection.limitReached).toBe("chunks");
  });

  it("enforces the token ceiling", () => {
    const selection = selectWithinBudget(chunks, { maxTokens: 5, maxBytes: 1e7, maxChunks: 1000 });
    expect(selection.totalEstimatedTokens).toBeLessThanOrEqual(5);
    expect(selection.limitReached).toBe("tokens");
  });

  it("enforces the byte ceiling", () => {
    const selection = selectWithinBudget(chunks, { maxTokens: 1e6, maxBytes: 30, maxChunks: 1000 });
    expect(selection.totalBytes).toBeLessThanOrEqual(30);
    expect(selection.limitReached).toBe("bytes");
  });
});

describe("QubereDocumentContextV1", () => {
  const baseInput = {
    documentId: "doc_1",
    filename: "INV-45678.pdf",
    documentType: "Commercial Invoice",
    documentRole: null,
    processingRunId: "run_1",
    purpose: "TRADE_EXTRACTION" as const,
    budget: BUDGET,
  };

  it("validates against its own schema", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    expect(qubereDocumentContextSchema.safeParse(context).success).toBe(true);
    expect(context.schemaVersion).toBe(QUBERE_DOCUMENT_CONTEXT_VERSION);
  });

  it("carries parser attribution including an unreported OCR flag", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    expect(context.parser.provider).toBe("IBM_DOCLING");
    expect(context.parser.profile).toBe("STANDARD");
    expect(context.parser.processingRunId).toBe("run_1");
    expect(context.parser.ocrUsed).toBeNull();
  });

  it("exposes no raw parser payload, storage location, or credential", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    const serialised = JSON.stringify(context);
    // The vendor's own schema name and internal refs must not reach an agent.
    expect(serialised).not.toContain("json_content");
    expect(serialised).not.toContain("table_cells");
    expect(serialised).not.toContain("blob.vercel-storage.com");
    expect(serialised).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(serialised).not.toContain("accountId");
  });

  it("keeps provenance on every section it includes", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    expect(context.sections.length).toBeGreaterThan(0);
    for (const section of context.sections) {
      expect(section.provenance.length).toBeGreaterThan(0);
    }
  });

  it("keeps tables structured, with row and column counts, not just Markdown", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    const items = context.tables.find((t) => t.id === "tbl_items");
    expect(items?.rowCount).toBe(7);
    expect(items?.columnCount).toBe(2);
    expect(items?.markdown).toContain("Part 1 description");
    expect(items?.page).toBe(2);
  });

  it("reports an opaque artifact handle for table HTML, never a storage reference", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      result: parsed(),
      tableHtmlRefs: { tbl_items: "artifact:TABLE_HTML:tbl_items" },
    });
    const items = context.tables.find((t) => t.id === "tbl_items");
    expect(items?.htmlArtifactRef).toBe("artifact:TABLE_HTML:tbl_items");
    expect(items?.htmlArtifactRef).not.toMatch(/^https?:/);
  });

  it("ranks the first page and headings first for classification", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      purpose: "CLASSIFICATION",
      result: parsed(),
    });
    expect(context.sections[0].pageStart).toBe(1);
  });

  it("ranks line-item tables first for commodity work", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      purpose: "COMMODITY_ATTRIBUTES",
      result: parsed(),
    });
    expect(context.tables.length).toBeGreaterThan(0);
  });

  it("reports truncation in the object when the budget bites", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      result: parsed(),
      budget: { ...BUDGET, maxChunks: 1 },
    });
    expect(context.budget.truncated).toBe(true);
    expect(context.budget.droppedSectionCount + context.budget.droppedTableCount).toBeGreaterThan(0);
    expect(context.budget.estimatedTokens).toBeLessThanOrEqual(BUDGET.maxTokens);
  });

  it("states truncation in the rendered prompt, so absence is never read as fact", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      result: parsed(),
      budget: { ...BUDGET, maxChunks: 1 },
    });
    const rendered = renderContextForPrompt(context);
    expect(rendered).toMatch(/INCOMPLETE CONTEXT/);
    expect(rendered).toMatch(/not present in the supplied context/);
  });

  it("does not claim truncation when nothing was dropped", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    expect(context.budget.truncated).toBe(false);
    expect(renderContextForPrompt(context)).not.toMatch(/INCOMPLETE CONTEXT/);
  });

  it("states an unreported parser version as unreported rather than omitting it", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      result: parsed({ metadata: { ...parsed().metadata, parserVersion: null } }),
    });
    expect(renderContextForPrompt(context)).toMatch(/version=not reported by the parser/);
  });

  it("surfaces parser warnings into the prompt", () => {
    const context = buildQubereDocumentContext({
      ...baseInput,
      result: parsed({
        warnings: [{ code: "MOCK_PROVIDER", message: "not a real parse", page: null }],
      }),
    });
    expect(renderContextForPrompt(context)).toContain("MOCK_PROVIDER");
  });

  it("labels every section and table with its stable id so a model can cite it", () => {
    const context = buildQubereDocumentContext({ ...baseInput, result: parsed() });
    const rendered = renderContextForPrompt(context);
    for (const section of context.sections) expect(rendered).toContain(section.id);
    for (const table of context.tables) expect(rendered).toContain(table.id);
  });
});
