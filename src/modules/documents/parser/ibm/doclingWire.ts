/**
 * IBM-hosted Docling wire contract.
 *
 * These schemas describe the provider's payloads, versioned separately from the
 * Qubere parser contract. They are deliberately tolerant: every field Qubere
 * does not strictly require is optional and unknown keys pass through, because a
 * hosted deployment may add fields or omit ones a self-hosted build emits. A
 * missing field must read as "the provider did not report this", never as a
 * default value that would fabricate parser metadata.
 *
 * Only fields that appear in the documented `/convert/source/async`,
 * `/status/poll/{task_id}` and `/result/{task_id}` contracts are modelled here.
 * Nothing undocumented is invented.
 */

import { z } from "zod";

export const DOCLING_WIRE_CONTRACT_VERSION = "ibm.docling.serve/v1";

// ---------------------------------------------------------------------------
// Submission response
// ---------------------------------------------------------------------------

export const doclingTaskEnvelopeSchema = z
  .object({
    task_id: z.string().min(1),
    task_status: z.string().optional(),
    task_position: z.number().nullable().optional(),
  })
  .passthrough();
export type DoclingTaskEnvelope = z.infer<typeof doclingTaskEnvelopeSchema>;

/**
 * Provider task statuses, as documented for docling-serve's async API.
 *
 * Anything not listed is treated as unknown and keeps the run polling rather
 * than being guessed into success or failure — see `translateTaskStatus`.
 */
export const DOCLING_PENDING_STATUSES = ["pending", "queued", "started", "running"] as const;
export const DOCLING_SUCCESS_STATUSES = ["success", "succeeded", "completed"] as const;
export const DOCLING_FAILURE_STATUSES = ["failure", "failed", "error", "revoked", "cancelled"] as const;

// ---------------------------------------------------------------------------
// DoclingDocument (the canonical parser artifact)
// ---------------------------------------------------------------------------

export const doclingBboxSchema = z
  .object({
    l: z.number(),
    t: z.number(),
    r: z.number(),
    b: z.number(),
    coord_origin: z.string().optional(),
  })
  .passthrough();

export const doclingProvSchema = z
  .object({
    page_no: z.number().optional(),
    bbox: doclingBboxSchema.optional(),
    charspan: z.array(z.number()).optional(),
  })
  .passthrough();

export const doclingTextItemSchema = z
  .object({
    self_ref: z.string().optional(),
    label: z.string().optional(),
    /** Heading depth for section_header items. */
    level: z.number().optional(),
    text: z.string().optional(),
    orig: z.string().optional(),
    prov: z.array(doclingProvSchema).optional(),
  })
  .passthrough();

export const doclingTableCellSchema = z
  .object({
    text: z.string().optional(),
    bbox: doclingBboxSchema.optional(),
    row_span: z.number().optional(),
    col_span: z.number().optional(),
    start_row_offset_idx: z.number().optional(),
    end_row_offset_idx: z.number().optional(),
    start_col_offset_idx: z.number().optional(),
    end_col_offset_idx: z.number().optional(),
    column_header: z.boolean().optional(),
    row_header: z.boolean().optional(),
    row_section: z.boolean().optional(),
  })
  .passthrough();

export const doclingTableSchema = z
  .object({
    self_ref: z.string().optional(),
    label: z.string().optional(),
    prov: z.array(doclingProvSchema).optional(),
    captions: z.array(z.unknown()).optional(),
    data: z
      .object({
        table_cells: z.array(doclingTableCellSchema).optional(),
        num_rows: z.number().optional(),
        num_cols: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const doclingPageSchema = z
  .object({
    page_no: z.number().optional(),
    size: z.object({ width: z.number(), height: z.number() }).passthrough().optional(),
  })
  .passthrough();

export const doclingDocumentSchema = z
  .object({
    schema_name: z.string().optional(),
    version: z.string().optional(),
    name: z.string().optional(),
    origin: z
      .object({
        mimetype: z.string().optional(),
        binary_hash: z.union([z.string(), z.number()]).optional(),
        filename: z.string().optional(),
      })
      .passthrough()
      .optional(),
    texts: z.array(doclingTextItemSchema).optional(),
    tables: z.array(doclingTableSchema).optional(),
    pictures: z.array(z.unknown()).optional(),
    pages: z.record(z.string(), doclingPageSchema).optional(),
  })
  .passthrough();
export type DoclingDocument = z.infer<typeof doclingDocumentSchema>;

// ---------------------------------------------------------------------------
// Result response
// ---------------------------------------------------------------------------

/**
 * Per-document confidence, as this hosted deployment genuinely reports it.
 *
 * Every score is nullable because the service returns null for a dimension it
 * did not measure -- `ocr_score` is null on a born-digital page where OCR never
 * ran, and `table_score` is null when the document has no tables. Null therefore
 * means "not measured", which is not the same as zero and must never be coerced
 * into one.
 */
export const doclingConfidenceSchema = z
  .object({
    parse_score: z.number().nullable().optional(),
    layout_score: z.number().nullable().optional(),
    table_score: z.number().nullable().optional(),
    ocr_score: z.number().nullable().optional(),
    mean_score: z.number().nullable().optional(),
    low_score: z.number().nullable().optional(),
    mean_grade: z.string().nullable().optional(),
    low_grade: z.string().nullable().optional(),
  })
  .passthrough();
export type DoclingConfidence = z.infer<typeof doclingConfidenceSchema>;

/**
 * One converted output, delivered as a short-lived presigned URL rather than
 * inline content. `url_expires_at` is when that URL stops working; re-reading
 * the task result mints fresh ones.
 */
export const doclingArtifactSchema = z
  .object({
    artifact_type: z.string(),
    mime_type: z.string().optional(),
    uri: z.string().url(),
    url_expires_at: z.string().optional(),
  })
  .passthrough();
export type DoclingArtifact = z.infer<typeof doclingArtifactSchema>;

/**
 * The batch-shaped result envelope this hosted deployment returns, in which the
 * converted content lives behind artifact URLs instead of being inlined.
 *
 * Distinct from `doclingResultSchema` below, which is the inline shape the
 * self-hosted `/convert/source` endpoints return. The provider detects which one
 * it received rather than assuming, because a single deployment exposes both
 * `/convert/file/async` and `/convert/source/async`.
 */
export const doclingBatchResultSchema = z
  .object({
    num_converted: z.number().optional(),
    num_succeeded: z.number().optional(),
    num_partially_succeeded: z.number().optional(),
    num_failed: z.number().optional(),
    /** Seconds, as reported by the provider. */
    processing_time: z.number().optional(),
    documents: z.array(
      z
        .object({
          source_index: z.number().optional(),
          source_uri: z.string().optional(),
          filename: z.string().optional(),
          status: z.string().optional(),
          errors: z.array(z.unknown()).optional(),
          timings: z.record(z.string(), z.unknown()).optional(),
          artifacts: z.array(doclingArtifactSchema).optional(),
          confidence: doclingConfidenceSchema.nullable().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();
export type DoclingBatchResult = z.infer<typeof doclingBatchResultSchema>;

/** Artifact type values this deployment uses for the formats Qubere requests. */
export const DOCLING_JSON_ARTIFACT_TYPES = ["json", "docling", "doctags"] as const;
export const DOCLING_MARKDOWN_ARTIFACT_TYPES = ["markdown", "md"] as const;

export const doclingResultSchema = z
  .object({
    document: z
      .object({
        filename: z.string().optional(),
        md_content: z.string().nullable().optional(),
        json_content: doclingDocumentSchema.nullable().optional(),
        html_content: z.string().nullable().optional(),
        text_content: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    status: z.string().optional(),
    errors: z.array(z.unknown()).optional(),
    /** Seconds, as reported by the provider. */
    processing_time: z.number().optional(),
    timings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type DoclingResultEnvelope = z.infer<typeof doclingResultSchema>;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * How sources are wrapped in the request body.
 *
 * docling-serve has shipped two shapes: a single polymorphic `sources` array
 * with a `kind` discriminator, and separate `file_sources` / `http_sources`
 * arrays. Which one a given hosted deployment accepts is not something Qubere
 * can determine without calling it, so it is configuration
 * (`DOCLING_SOURCE_ENVELOPE`) rather than a guess baked into the code.
 */
export type DoclingSourceEnvelope = "sources" | "typed";

export interface DoclingConvertOptions {
  to_formats: string[];
  do_ocr: boolean;
  force_ocr: boolean;
  do_table_structure: boolean;
  table_mode?: string;
  include_images: boolean;
}

/** Text label values Docling uses for headings. */
export const DOCLING_HEADING_LABELS = new Set(["section_header", "title", "page_header"]);

/** Text label values whose content is document body prose. */
export const DOCLING_BODY_LABELS = new Set([
  "text",
  "paragraph",
  "list_item",
  "caption",
  "code",
  "formula",
  "checkbox_selected",
  "checkbox_unselected",
  "footnote",
  "page_footer",
  "reference",
]);
