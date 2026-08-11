/**
 * Deterministic, structure-aware chunking.
 *
 * Chunks follow the document's own structure rather than a fixed character
 * window: a section stays whole where it fits, and is split at line boundaries
 * where it does not. Every chunk keeps the heading trail it sits under and the
 * page/bbox provenance of the material it contains, because a chunk that cannot
 * be traced back to a page is unusable as customs evidence.
 *
 * Chunk ids are deterministic functions of (algorithm version, source element id,
 * ordinal within that element, content). Re-running the same parser result
 * through the same algorithm produces identical ids, so an evidence reference
 * recorded weeks ago still resolves.
 *
 * Pure and database-free.
 */

import { createHash } from "crypto";
import type { NormalizedParserResult, ParsedTable, Provenance } from "./contracts";
import { tableToMarkdown } from "./ibm/doclingAdapter";

/** Bump when the splitting rules change; ids then change deliberately, not silently. */
export const CHUNKING_ALGORITHM_VERSION = "qubere.chunk/1";

export interface DocumentChunk {
  /** Deterministic and stable for the same parser result and algorithm version. */
  id: string;
  kind: "section" | "table";
  /** Id of the parser element this chunk came from. */
  sourceElementId: string;
  headingPath: readonly string[];
  /** Plain text, or compact Markdown for a table chunk. */
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  byteCount: number;
  /** Estimated, and labelled as such — see `estimateTokens`. */
  estimatedTokenCount: number;
  contentHash: string;
  provenance: readonly Provenance[];
}

/**
 * Character-ratio token estimate.
 *
 * This is an estimate and is named one. Qubere does not ship a tokenizer for
 * every model it may call, and a budget enforced on an estimate that is
 * consistently *conservative* is safe: the ratio of 4 characters per token
 * over-counts tokens for English prose, so the real payload lands under budget
 * rather than over it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkId(sourceElementId: string, ordinal: number, content: string): string {
  const digest = createHash("sha256")
    .update(`${CHUNKING_ALGORITHM_VERSION}|${sourceElementId}|${ordinal}|${content}`)
    .digest("hex")
    .slice(0, 16);
  return `chk_${digest}`;
}

function pageSpan(provenance: readonly Provenance[]): { start: number | null; end: number | null } {
  const pages = provenance.map((p) => p.page).filter((p): p is number => p !== null);
  if (pages.length === 0) return { start: null, end: null };
  return { start: Math.min(...pages), end: Math.max(...pages) };
}

/**
 * Splits text at line boundaries into pieces no larger than `maxChars`.
 *
 * A single line longer than the limit is emitted whole rather than cut
 * mid-value: splitting "1,234,567.89" across two chunks would create two
 * plausible-looking wrong numbers, which is worse than one oversized chunk.
 */
function splitAtLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const pieces: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current === "") {
      current = line;
      continue;
    }
    if (current.length + 1 + line.length > maxChars) {
      pieces.push(current);
      current = line;
    } else {
      current = `${current}\n${line}`;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

export interface ChunkingOptions {
  /** Maximum characters per chunk before splitting. */
  maxChunkChars?: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 4_000;

/** Builds the full deterministic chunk set for a parser result. */
export function buildChunks(
  result: NormalizedParserResult,
  options?: ChunkingOptions
): DocumentChunk[] {
  const maxChars = options?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const chunks: DocumentChunk[] = [];

  for (const section of result.sections) {
    // A heading with no body is still worth a chunk: on a customs form the
    // heading often *is* the datum ("CERTIFICATE OF ORIGIN").
    const body =
      section.content === "" && section.headingPath.length > 0
        ? section.headingPath[section.headingPath.length - 1]
        : section.content;
    if (body === "") continue;

    const pieces = splitAtLines(body, maxChars);
    pieces.forEach((piece, ordinal) => {
      const span = pageSpan(section.provenance);
      chunks.push({
        id: chunkId(section.id, ordinal, piece),
        kind: "section",
        sourceElementId: section.id,
        headingPath: section.headingPath,
        content: piece,
        pageStart: span.start,
        pageEnd: span.end,
        byteCount: Buffer.byteLength(piece, "utf8"),
        estimatedTokenCount: estimateTokens(piece),
        contentHash: createHash("sha256").update(piece).digest("hex"),
        provenance: section.provenance,
      });
    });
  }

  for (const table of result.tables) {
    const markdown = tableToMarkdown(table);
    if (markdown === "") continue;
    const provenance: Provenance[] =
      table.page === null && table.bbox === null
        ? []
        : [{ page: table.page, bbox: table.bbox, elementRef: table.id }];

    const pieces = splitAtLines(markdown, maxChars);
    pieces.forEach((piece, ordinal) => {
      chunks.push({
        id: chunkId(table.id, ordinal, piece),
        kind: "table",
        sourceElementId: table.id,
        headingPath: [],
        content: piece,
        pageStart: table.page,
        pageEnd: table.page,
        byteCount: Buffer.byteLength(piece, "utf8"),
        estimatedTokenCount: estimateTokens(piece),
        contentHash: createHash("sha256").update(piece).digest("hex"),
        provenance,
      });
    });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Budgeted selection
// ---------------------------------------------------------------------------

export interface SelectionBudget {
  maxTokens: number;
  maxBytes: number;
  maxChunks: number;
}

export interface SelectionResult {
  selected: DocumentChunk[];
  /** Chunks the budget excluded. Reported so truncation is never silent. */
  droppedChunkCount: number;
  /** Which limit stopped selection, when one did. */
  limitReached: "tokens" | "bytes" | "chunks" | null;
  totalEstimatedTokens: number;
  totalBytes: number;
}

/**
 * Fills a budget in the order chunks are given, and reports what it left out.
 *
 * Callers order the chunks by relevance to the agent's purpose (see
 * `documentContext.ts`); this function only enforces the ceiling. Dropping is
 * always reported, because a context that silently lost the totals table would
 * make an extraction agent's "field not present" look like a fact about the
 * document rather than a fact about the budget.
 */
export function selectWithinBudget(
  chunks: readonly DocumentChunk[],
  budget: SelectionBudget
): SelectionResult {
  const selected: DocumentChunk[] = [];
  let tokens = 0;
  let bytes = 0;
  let limitReached: SelectionResult["limitReached"] = null;

  for (const chunk of chunks) {
    if (selected.length >= budget.maxChunks) {
      limitReached = "chunks";
      break;
    }
    if (tokens + chunk.estimatedTokenCount > budget.maxTokens) {
      limitReached = "tokens";
      break;
    }
    if (bytes + chunk.byteCount > budget.maxBytes) {
      limitReached = "bytes";
      break;
    }
    selected.push(chunk);
    tokens += chunk.estimatedTokenCount;
    bytes += chunk.byteCount;
  }

  return {
    selected,
    droppedChunkCount: chunks.length - selected.length,
    limitReached,
    totalEstimatedTokens: tokens,
    totalBytes: bytes,
  };
}

/** Orders tables so the ones most likely to matter to an agent come first. */
export function rankTables(tables: readonly ParsedTable[], limit: number): ParsedTable[] {
  // Larger tables carry the line items; a two-cell table is usually a stamp box.
  return [...tables]
    .sort((a, b) => b.cells.length - a.cells.length || a.index - b.index)
    .slice(0, limit);
}
