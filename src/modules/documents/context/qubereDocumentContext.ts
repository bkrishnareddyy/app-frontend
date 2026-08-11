/**
 * QubereDocumentContextV1 — the contract downstream agents consume.
 *
 * Raw Docling JSON never reaches an agent. It is unbounded, vendor-shaped, and
 * would couple every prompt to a provider we may replace. What agents get is
 * this: a Qubere-owned, versioned, budget-bounded projection carrying stable
 * ids and real provenance, and nothing else.
 *
 * Specifically excluded, deliberately: storage keys, signed URLs, API keys,
 * internal account identifiers, and any other document's content.
 */

import { z } from "zod";
import {
  boundingBoxSchema,
  provenanceSchema,
  type NormalizedParserResult,
  type ParsedTable,
} from "../parser/contracts";
import {
  buildChunks,
  rankTables,
  selectWithinBudget,
  type DocumentChunk,
  type SelectionBudget,
  CHUNKING_ALGORITHM_VERSION,
} from "../parser/chunking";
import { tableToMarkdown } from "../parser/ibm/doclingAdapter";
import type { ContextBudget } from "../parser/config";

export const QUBERE_DOCUMENT_CONTEXT_VERSION = "1" as const;

/**
 * What the context is being built for. Determines which material is included
 * and in what order, so a classifier is not handed forty pages of line items and
 * an extraction agent is not handed only the first page.
 */
export const CONTEXT_PURPOSES = [
  "CLASSIFICATION",
  "TRADE_EXTRACTION",
  "COMMODITY_ATTRIBUTES",
  "RECONCILIATION",
] as const;
export type ContextPurpose = (typeof CONTEXT_PURPOSES)[number];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const contextSectionSchema = z.object({
  /** Stable chunk id. This is what an agent cites. */
  id: z.string(),
  /**
   * Id of the parser section this chunk came from.
   *
   * Completes the lineage chain: a cited context id resolves to a parser element,
   * which resolves through `provenance[].elementRef` to a specific element in the
   * canonical parser artifact, and from there to a page and bounding box.
   */
  sourceElementId: z.string(),
  headingPath: z.array(z.string()),
  content: z.string(),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  provenance: z.array(provenanceSchema),
});

export const contextTableSchema = z.object({
  id: z.string(),
  caption: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  bbox: boundingBoxSchema.nullable(),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  /** Compact Markdown rendering, for the model to read. */
  markdown: z.string(),
  /**
   * Opaque reference to the stored table HTML artifact, so a reviewer can open
   * the loss-minimising form. Never a URL, never a storage key.
   */
  htmlArtifactRef: z.string().nullable(),
});

export const qubereDocumentContextSchema = z.object({
  schemaVersion: z.literal(QUBERE_DOCUMENT_CONTEXT_VERSION),
  purpose: z.enum(CONTEXT_PURPOSES),
  document: z.object({
    /** Opaque Qubere document id. */
    id: z.string(),
    documentType: z.string(),
    documentRole: z.string().nullable(),
    filename: z.string(),
    pageCount: z.number().int().nonnegative().nullable(),
  }),
  parser: z.object({
    provider: z.string(),
    name: z.string().nullable(),
    version: z.string().nullable(),
    profile: z.string(),
    processingRunId: z.string(),
    /** Whether the parser reported OCR usage at all. Null means it did not say. */
    ocrUsed: z.boolean().nullable(),
  }),
  sections: z.array(contextSectionSchema),
  tables: z.array(contextTableSchema),
  warnings: z.array(
    z.object({ code: z.string(), message: z.string(), page: z.number().int().positive().nullable() })
  ),
  /** What the budget left out, so a model is never told a truncated document is whole. */
  budget: z.object({
    maxTokens: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
    estimatedTokens: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    droppedSectionCount: z.number().int().nonnegative(),
    droppedTableCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    limitReached: z.enum(["tokens", "bytes", "chunks"]).nullable(),
  }),
  chunkingAlgorithm: z.string(),
});
export type QubereDocumentContextV1 = z.infer<typeof qubereDocumentContextSchema>;

// ---------------------------------------------------------------------------
// Purpose-driven ordering
// ---------------------------------------------------------------------------

const HEADER_KEYWORDS = [
  "invoice",
  "shipper",
  "consignee",
  "exporter",
  "importer",
  "seller",
  "buyer",
  "notify",
  "incoterm",
  "currency",
  "total",
  "freight",
  "insurance",
  "origin",
  "port",
  "vessel",
  "voyage",
  "flight",
  "container",
  "seal",
  "bill of lading",
  "air waybill",
  "certificate",
  "declaration",
];

const COMMODITY_KEYWORDS = [
  "description",
  "commodity",
  "goods",
  "sku",
  "part",
  "model",
  "material",
  "hts",
  "hs code",
  "tariff",
  "quantity",
  "weight",
];

function keywordScore(chunk: DocumentChunk, keywords: readonly string[]): number {
  const haystack = `${chunk.headingPath.join(" ")} ${chunk.content}`.toLowerCase();
  return keywords.reduce((score, keyword) => (haystack.includes(keyword) ? score + 1 : score), 0);
}

/**
 * Orders chunks for a purpose.
 *
 * Ordering only decides what survives the budget; it never removes material a
 * budget would have admitted, and the exclusions it does cause are reported.
 */
function orderChunksForPurpose(chunks: readonly DocumentChunk[], purpose: ContextPurpose): DocumentChunk[] {
  const ordered = [...chunks];

  switch (purpose) {
    case "CLASSIFICATION":
      // A classifier needs to know what kind of document this is: the first page,
      // the headings, and a sample of structure. Deep line-item detail is noise.
      return ordered.sort((a, b) => {
        const aFirst = (a.pageStart ?? 99) <= 1 ? 0 : 1;
        const bFirst = (b.pageStart ?? 99) <= 1 ? 0 : 1;
        if (aFirst !== bFirst) return aFirst - bFirst;
        const aHeading = a.headingPath.length > 0 ? 0 : 1;
        const bHeading = b.headingPath.length > 0 ? 0 : 1;
        if (aHeading !== bHeading) return aHeading - bHeading;
        return keywordScore(b, HEADER_KEYWORDS) - keywordScore(a, HEADER_KEYWORDS);
      });

    case "TRADE_EXTRACTION":
      // Header, parties, totals and the item tables. Table chunks rank ahead of
      // prose because line values live in tables.
      return ordered.sort((a, b) => {
        const score = keywordScore(b, HEADER_KEYWORDS) - keywordScore(a, HEADER_KEYWORDS);
        if (score !== 0) return score;
        if (a.kind !== b.kind) return a.kind === "table" ? -1 : 1;
        return (a.pageStart ?? 0) - (b.pageStart ?? 0);
      });

    case "COMMODITY_ATTRIBUTES":
      return ordered.sort((a, b) => {
        const score = keywordScore(b, COMMODITY_KEYWORDS) - keywordScore(a, COMMODITY_KEYWORDS);
        if (score !== 0) return score;
        if (a.kind !== b.kind) return a.kind === "table" ? -1 : 1;
        return (a.pageStart ?? 0) - (b.pageStart ?? 0);
      });

    case "RECONCILIATION":
      // Reconciliation compares normalised facts, not prose. What it needs from
      // the document is the tables the numbers came from, in document order.
      return ordered
        .filter((chunk) => chunk.kind === "table" || keywordScore(chunk, HEADER_KEYWORDS) > 0)
        .sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0));
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildContextInput {
  documentId: string;
  filename: string;
  documentType: string;
  documentRole: string | null;
  processingRunId: string;
  result: NormalizedParserResult;
  purpose: ContextPurpose;
  budget: ContextBudget;
  /** Opaque refs to stored table HTML artifacts, keyed by table id. */
  tableHtmlRefs?: Readonly<Record<string, string>>;
}

/**
 * Builds and validates a QubereDocumentContextV1.
 *
 * Validation is not ceremonial: it is the guarantee that a bug in ordering or
 * budgeting cannot hand an agent a malformed context that it would then
 * confidently extract customs facts from.
 */
export function buildQubereDocumentContext(input: BuildContextInput): QubereDocumentContextV1 {
  const { result, budget } = input;

  const allChunks = buildChunks(result);
  const ordered = orderChunksForPurpose(allChunks, input.purpose);

  const selectionBudget: SelectionBudget = {
    maxTokens: budget.maxTokens,
    maxBytes: budget.maxBytes,
    maxChunks: budget.maxChunks,
  };
  const selection = selectWithinBudget(ordered, selectionBudget);
  const selectedIds = new Set(selection.selected.map((chunk) => chunk.sourceElementId));

  const sections = selection.selected
    .filter((chunk) => chunk.kind === "section")
    .map((chunk) => ({
      id: chunk.id,
      sourceElementId: chunk.sourceElementId,
      headingPath: [...chunk.headingPath],
      content: chunk.content,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      provenance: chunk.provenance.map((p) => ({ ...p })),
    }));

  // Tables are surfaced as first-class structures in addition to their chunk
  // form, because an extraction agent reasoning about a line-item grid needs the
  // row/column shape, not just the flattened Markdown.
  const admittedTables: ParsedTable[] = rankTables(
    result.tables.filter((table) => selectedIds.has(table.id)),
    budget.maxTables
  );

  const tables = admittedTables.map((table) => ({
    id: table.id,
    caption: table.caption,
    page: table.page,
    bbox: table.bbox,
    rowCount: table.rowCount,
    columnCount: table.columnCount,
    markdown: tableToMarkdown(table),
    htmlArtifactRef: input.tableHtmlRefs?.[table.id] ?? null,
  }));

  const droppedTableCount = result.tables.length - tables.length;
  const droppedSectionCount =
    allChunks.filter((chunk) => chunk.kind === "section").length -
    selection.selected.filter((chunk) => chunk.kind === "section").length;

  const context: QubereDocumentContextV1 = {
    schemaVersion: QUBERE_DOCUMENT_CONTEXT_VERSION,
    purpose: input.purpose,
    document: {
      id: input.documentId,
      documentType: input.documentType,
      documentRole: input.documentRole,
      filename: input.filename,
      pageCount: result.metadata.pageCount,
    },
    parser: {
      provider: result.metadata.provider,
      name: result.metadata.parserName,
      version: result.metadata.parserVersion,
      profile: result.profile,
      processingRunId: input.processingRunId,
      ocrUsed: result.metadata.ocrUsed,
    },
    sections,
    tables,
    warnings: result.warnings.map((warning) => ({ ...warning })),
    budget: {
      maxTokens: budget.maxTokens,
      maxBytes: budget.maxBytes,
      estimatedTokens: selection.totalEstimatedTokens,
      bytes: selection.totalBytes,
      droppedSectionCount: Math.max(0, droppedSectionCount),
      droppedTableCount: Math.max(0, droppedTableCount),
      truncated: selection.droppedChunkCount > 0 || droppedTableCount > 0,
      limitReached: selection.limitReached,
    },
    chunkingAlgorithm: CHUNKING_ALGORITHM_VERSION,
  };

  const validated = qubereDocumentContextSchema.safeParse(context);
  if (!validated.success) {
    throw new Error(
      `QubereDocumentContextV1 failed validation: ${validated.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`
    );
  }
  return validated.data;
}

/**
 * Renders a context as the text an agent prompt embeds.
 *
 * Truncation is stated in the rendered text, not just in the object, so a model
 * cannot conclude "this field is absent from the document" when the real
 * situation is "this field was outside the budget".
 */
export function renderContextForPrompt(context: QubereDocumentContextV1): string {
  const parts: string[] = [];

  parts.push(
    `DOCUMENT: ${context.document.filename} (type: ${context.document.documentType}, pages: ${
      context.document.pageCount ?? "unreported"
    })`
  );
  parts.push(
    `PARSER: ${context.parser.provider} profile=${context.parser.profile} version=${
      context.parser.version ?? "not reported by the parser"
    } ocrUsed=${context.parser.ocrUsed === null ? "not reported" : String(context.parser.ocrUsed)}`
  );

  if (context.budget.truncated) {
    parts.push(
      `INCOMPLETE CONTEXT: ${context.budget.droppedSectionCount} section(s) and ${context.budget.droppedTableCount} table(s) were omitted to stay within the context budget (limit reached: ${context.budget.limitReached ?? "table cap"}). Treat any field you cannot find as "not present in the supplied context", not as absent from the document.`
    );
  }

  if (context.warnings.length > 0) {
    parts.push(
      `PARSER WARNINGS: ${context.warnings.map((w) => `${w.code}: ${w.message}`).join(" | ")}`
    );
  }

  for (const section of context.sections) {
    const heading = section.headingPath.length > 0 ? section.headingPath.join(" > ") : "(no heading)";
    const pages =
      section.pageStart === null
        ? "page unreported"
        : section.pageStart === section.pageEnd
          ? `page ${section.pageStart}`
          : `pages ${section.pageStart}-${section.pageEnd}`;
    parts.push(
      `--- SECTION ${section.id} (parser element ${section.sourceElementId}) [${heading}] (${pages}) ---\n${section.content}`
    );
  }

  for (const table of context.tables) {
    const pages = table.page === null ? "page unreported" : `page ${table.page}`;
    parts.push(
      `--- TABLE ${table.id} (${pages}, ${table.rowCount}x${table.columnCount}) ---\n${table.markdown}`
    );
  }

  return parts.join("\n\n");
}
