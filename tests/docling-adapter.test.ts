import { describe, it, expect } from "vitest";
import {
  adaptDoclingResult,
  tableCellsToHtml,
  tableToMarkdown,
  translateTaskStatus,
} from "@/modules/documents/parser/ibm/doclingAdapter";
import { DocumentParserError, parserResultSchema } from "@/modules/documents/parser/contracts";

/**
 * The adapter is where a vendor payload becomes Qubere evidence. Two properties
 * are tested hardest: absence stays absent (no invented pages, boxes, versions or
 * confidences), and identifiers are stable across reruns.
 */

/** A DoclingDocument shaped like a real commercial invoice conversion. */
function invoiceDocument() {
  return {
    schema_name: "DoclingDocument",
    version: "1.3.0",
    name: "INV-45678.pdf",
    origin: { mimetype: "application/pdf", filename: "INV-45678.pdf" },
    texts: [
      {
        self_ref: "#/texts/0",
        label: "title",
        level: 1,
        text: "COMMERCIAL INVOICE",
        prov: [{ page_no: 1, bbox: { l: 60, t: 720, r: 300, b: 700, coord_origin: "BOTTOMLEFT" } }],
      },
      {
        self_ref: "#/texts/1",
        label: "text",
        text: "Invoice No: INV-45678",
        prov: [{ page_no: 1, bbox: { l: 60, t: 690, r: 260, b: 675, coord_origin: "BOTTOMLEFT" } }],
      },
      {
        self_ref: "#/texts/2",
        label: "section_header",
        level: 2,
        text: "Parties",
        prov: [{ page_no: 1, bbox: { l: 60, t: 650, r: 160, b: 635, coord_origin: "BOTTOMLEFT" } }],
      },
      {
        self_ref: "#/texts/3",
        label: "text",
        text: "Shipper: ACME Manufacturing GmbH",
        prov: [{ page_no: 1 }],
      },
      {
        // No provenance at all, which happens; it must not become page 1.
        self_ref: "#/texts/4",
        label: "text",
        text: "Consignee: Target Imports LLC",
      },
      {
        self_ref: "#/texts/5",
        label: "some_future_label",
        text: "STAMPED: CUSTOMS CLEARED",
        prov: [{ page_no: 2 }],
      },
    ],
    tables: [
      {
        self_ref: "#/tables/0",
        label: "table",
        prov: [{ page_no: 2, bbox: { l: 40, t: 600, r: 560, b: 400, coord_origin: "BOTTOMLEFT" } }],
        data: {
          num_rows: 2,
          num_cols: 3,
          table_cells: [
            {
              text: "Description",
              column_header: true,
              start_row_offset_idx: 0,
              end_row_offset_idx: 1,
              start_col_offset_idx: 0,
              end_col_offset_idx: 1,
            },
            {
              text: "Qty",
              column_header: true,
              start_row_offset_idx: 0,
              end_row_offset_idx: 1,
              start_col_offset_idx: 1,
              end_col_offset_idx: 2,
            },
            {
              text: "Value",
              column_header: true,
              start_row_offset_idx: 0,
              end_row_offset_idx: 1,
              start_col_offset_idx: 2,
              end_col_offset_idx: 3,
            },
            {
              text: "Stainless valve",
              bbox: { l: 42, t: 560, r: 200, b: 545, coord_origin: "BOTTOMLEFT" },
              start_row_offset_idx: 1,
              end_row_offset_idx: 2,
              start_col_offset_idx: 0,
              end_col_offset_idx: 1,
            },
            {
              text: "120",
              start_row_offset_idx: 1,
              end_row_offset_idx: 2,
              start_col_offset_idx: 1,
              end_col_offset_idx: 2,
            },
            {
              text: "18,240.00",
              start_row_offset_idx: 1,
              end_row_offset_idx: 2,
              start_col_offset_idx: 2,
              end_col_offset_idx: 3,
            },
          ],
        },
      },
    ],
    pictures: [],
    pages: { "1": { page_no: 1 }, "2": { page_no: 2 } },
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    document: {
      filename: "INV-45678.pdf",
      md_content: "# COMMERCIAL INVOICE\n\nInvoice No: INV-45678",
      json_content: invoiceDocument(),
    },
    status: "success",
    errors: [],
    processing_time: 4.25,
    ...overrides,
  };
}

describe("Docling result adaptation", () => {
  it("produces a result that validates against the Qubere parser contract", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    expect(parserResultSchema.safeParse(normalized).success).toBe(true);
    expect(normalized.contractVersion).toBe("qubere.parser/1");
    expect(normalized.profile).toBe("STANDARD");
  });

  it("keeps the provider's structured document as the canonical artifact", () => {
    const { canonical } = adaptDoclingResult(envelope(), "STANDARD");
    // Markdown is derivative; the JSON document is what is preserved verbatim.
    expect((canonical as { schema_name?: string }).schema_name).toBe("DoclingDocument");
    expect((canonical as { tables?: unknown[] }).tables).toHaveLength(1);
  });

  it("stores Markdown as a derivative rather than the canonical form", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    expect(normalized.markdown).toContain("COMMERCIAL INVOICE");
  });

  it("groups body text under the heading trail it sits beneath", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    const parties = normalized.sections.find((s) => s.headingPath.includes("Parties"));
    expect(parties).toBeDefined();
    expect(parties?.content).toContain("ACME Manufacturing GmbH");
    expect(parties?.content).toContain("Target Imports LLC");
    // "Parties" is level 2 under the level 1 title, so the trail nests.
    expect(parties?.headingPath).toEqual(["COMMERCIAL INVOICE", "Parties"]);
  });

  it("preserves real bounding boxes with the coordinate origin the parser reported", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    const titled = normalized.sections[0];
    const box = titled.provenance.find((p) => p.bbox !== null)?.bbox;
    expect(box).toEqual({ left: 60, top: 720, right: 300, bottom: 700, coordOrigin: "BOTTOMLEFT" });
  });

  it("never fabricates a bounding box or a page for an element that had none", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    const allProvenance = normalized.sections.flatMap((s) => s.provenance);
    // The consignee line carried no prov array. Absence is represented, not filled.
    const withoutPage = allProvenance.filter((p) => p.page === null);
    expect(withoutPage.length).toBeGreaterThan(0);
    for (const entry of withoutPage) expect(entry.bbox).toBeNull();
  });

  it("never fabricates parser or OCR confidence", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    expect(normalized.metadata.parserConfidence).toBeNull();
    expect(normalized.metadata.ocrConfidence).toBeNull();
  });

  it("reports OCR usage as unknown because the hosted contract does not expose it", () => {
    const { normalized } = adaptDoclingResult(envelope(), "FULL_PAGE_OCR");
    // Requesting full-page OCR is not evidence that it ran. Null says so.
    expect(normalized.metadata.ocrUsed).toBeNull();
    expect(normalized.metadata.fullPageOcrUsed).toBeNull();
    expect(normalized.metadata.ocrEngine).toBeNull();
  });

  it("reports the parser version the provider gave, and null when it gives none", () => {
    const withVersion = adaptDoclingResult(envelope(), "STANDARD");
    expect(withVersion.normalized.metadata.parserVersion).toBe("1.3.0");

    const document = invoiceDocument();
    delete (document as { version?: string }).version;
    const withoutVersion = adaptDoclingResult(
      envelope({ document: { md_content: "x", json_content: document } }),
      "STANDARD"
    );
    expect(withoutVersion.normalized.metadata.parserVersion).toBeNull();
  });

  it("converts the provider's processing time into milliseconds", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    expect(normalized.metadata.processingDurationMs).toBe(4250);
  });

  it("counts pages from the parser's own page map", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    expect(normalized.metadata.pageCount).toBe(2);
    expect(normalized.pageTextLengths).toHaveLength(2);
    expect(normalized.pageTextLengths[0]).toBeGreaterThan(0);
  });

  it("keeps tables structured rather than flattening them to text", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    const table = normalized.tables[0];
    expect(table.rowCount).toBe(2);
    expect(table.columnCount).toBe(3);
    expect(table.cells).toHaveLength(6);
    expect(table.page).toBe(2);
    expect(table.bbox).not.toBeNull();
    const header = table.cells.filter((c) => c.isHeader);
    expect(header.map((c) => c.text)).toEqual(["Description", "Qty", "Value"]);
  });

  it("stores table HTML as a loss-minimising derivative", () => {
    const { normalized } = adaptDoclingResult(envelope(), "STANDARD");
    const html = normalized.tables[0].html ?? "";
    expect(html).toContain("<th>Description</th>");
    expect(html).toContain("<td>18,240.00</td>");
  });

  it("raises a warning for element labels it does not normalise, and keeps the canonical payload", () => {
    const { normalized, canonical } = adaptDoclingResult(envelope(), "STANDARD");
    const warning = normalized.warnings.find((w) => w.code === "UNSUPPORTED_ELEMENT_LABEL");
    expect(warning?.message).toContain("some_future_label");
    // The unnormalised element is still recoverable from the canonical artifact.
    expect(JSON.stringify(canonical)).toContain("CUSTOMS CLEARED");
  });

  it("records provider-reported errors as non-fatal warnings", () => {
    const { normalized } = adaptDoclingResult(
      envelope({ errors: ["page 3 could not be rendered"] }),
      "STANDARD"
    );
    const warning = normalized.warnings.find((w) => w.code === "PROVIDER_REPORTED_ERROR");
    expect(warning?.message).toContain("page 3");
  });

  it("produces stable ids for the same result, so old evidence references resolve", () => {
    const first = adaptDoclingResult(envelope(), "STANDARD").normalized;
    const second = adaptDoclingResult(envelope(), "STANDARD").normalized;
    expect(second.sections.map((s) => s.id)).toEqual(first.sections.map((s) => s.id));
    expect(second.tables.map((t) => t.id)).toEqual(first.tables.map((t) => t.id));
  });

  it("changes an id when the content behind it changes", () => {
    const altered = invoiceDocument();
    altered.texts[1].text = "Invoice No: INV-99999";
    const changed = adaptDoclingResult(
      envelope({ document: { md_content: "x", json_content: altered } }),
      "STANDARD"
    ).normalized;
    const original = adaptDoclingResult(envelope(), "STANDARD").normalized;
    expect(changed.sections[0].id).not.toBe(original.sections[0].id);
  });
});

describe("Docling result adaptation failures", () => {
  it("rejects a payload that is not the provider's contract", () => {
    expect(() => adaptDoclingResult({ unexpected: true }, "STANDARD")).toThrowError(
      DocumentParserError
    );
    try {
      adaptDoclingResult(42, "STANDARD");
    } catch (error) {
      expect((error as DocumentParserError).code).toBe("PARSER_RESULT_INVALID");
      // The same malformed payload will not become valid on a second attempt.
      expect((error as DocumentParserError).retryable).toBe(false);
    }
  });

  it("rejects a completion that carried no document content at all", () => {
    try {
      adaptDoclingResult(
        { status: "success", document: { md_content: null, json_content: null } },
        "STANDARD"
      );
      throw new Error("expected a failure");
    } catch (error) {
      expect((error as DocumentParserError).code).toBe("PARSER_RESULT_INCOMPLETE");
    }
  });

  it("accepts a result with no structured document but flags it", () => {
    // Markdown-only is degraded but real; it must not be silently equivalent to
    // a structured parse.
    const { normalized } = adaptDoclingResult(
      { status: "success", document: { md_content: "Invoice 1", json_content: null } },
      "STANDARD"
    );
    expect(normalized.warnings.map((w) => w.code)).toContain("NO_STRUCTURED_DOCUMENT");
    expect(normalized.sections).toHaveLength(0);
  });

  it("tolerates a result whose tables lack cell offsets", () => {
    const document = invoiceDocument();
    document.tables[0].data.table_cells = [{ text: "orphan" }] as never;
    const { normalized } = adaptDoclingResult(
      envelope({ document: { md_content: "x", json_content: document } }),
      "STANDARD"
    );
    // A cell with no position cannot be placed, so it is not invented into 0,0.
    expect(normalized.tables[0].cells).toHaveLength(0);
    expect(normalized.tables[0].html).toBeNull();
  });
});

describe("provider status translation", () => {
  it("maps the documented statuses onto Qubere states", () => {
    expect(translateTaskStatus("success")).toEqual({ state: "SUCCEEDED", recognised: true });
    expect(translateTaskStatus("failure")).toEqual({ state: "FAILED", recognised: true });
    expect(translateTaskStatus("pending")).toEqual({ state: "POLLING", recognised: true });
    expect(translateTaskStatus("started")).toEqual({ state: "POLLING", recognised: true });
  });

  it("is case and whitespace insensitive", () => {
    expect(translateTaskStatus("  SUCCESS  ").state).toBe("SUCCEEDED");
  });

  it("keeps polling on an unfamiliar status instead of guessing", () => {
    // Guessing FAILED discards work still running; guessing SUCCEEDED fetches a
    // result that does not exist. Polling is the only safe reading.
    const unknown = translateTaskStatus("rehydrating");
    expect(unknown.state).toBe("POLLING");
    expect(unknown.recognised).toBe(false);
  });
});

describe("table renderings", () => {
  const table = {
    id: "tbl_test",
    index: 0,
    caption: null,
    page: 1,
    bbox: null,
    rowCount: 2,
    columnCount: 2,
    html: null,
    cells: [
      { row: 0, column: 0, rowSpan: 1, columnSpan: 2, isHeader: true, text: "Header spanning", provenance: null },
      { row: 1, column: 0, rowSpan: 1, columnSpan: 1, isHeader: false, text: "a | b", provenance: null },
      { row: 1, column: 1, rowSpan: 1, columnSpan: 1, isHeader: false, text: "c", provenance: null },
    ],
  };

  it("preserves spans in HTML", () => {
    expect(tableCellsToHtml(table)).toContain('colspan="2"');
  });

  it("escapes content so a cell cannot inject markup", () => {
    const risky = { ...table, cells: [{ ...table.cells[1], text: "<script>x</script>" }] };
    const html = tableCellsToHtml(risky);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes pipes in Markdown so a cell cannot break the grid", () => {
    expect(tableToMarkdown(table)).toContain("a \\| b");
  });

  it("puts the Markdown separator after the last header row, not after row zero", () => {
    const lines = tableToMarkdown(table).split("\n");
    expect(lines[1]).toMatch(/^\|\s*---/);
  });
});
