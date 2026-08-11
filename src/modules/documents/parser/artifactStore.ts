/**
 * Persists a processing run's artifacts to object storage.
 *
 * Large payloads never go into Postgres. The database holds the index: which
 * artifact types exist for a run, where each one lives, how big it is, and its
 * SHA-256. That keeps the relational store queryable and makes a run's outputs
 * verifiable after the fact.
 *
 * The artifact set is written before the run is marked SUCCEEDED, so a run that
 * claims success always has its evidence on disk.
 */

import { z } from "zod";
import { storeProcessingArtifact, readProcessingArtifact } from "@/lib/storage";
import {
  DocumentParserError,
  QUBERE_PARSER_CONTRACT_VERSION,
  type NormalizedParserResult,
} from "./contracts";
import type { QualityAssessment } from "./qualityGate";

export const ARTIFACT_TYPES = [
  "DOCLING_JSON",
  "MARKDOWN",
  "NORMALIZED_JSON",
  "TABLES_JSON",
  "TABLE_HTML",
  "QUALITY_REPORT",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const artifactRefSchema = z.object({
  artifactType: z.enum(ARTIFACT_TYPES),
  /** Storage reference. Never exposed to a model or a browser. */
  storageRef: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  /** Contract version this artifact was written under. */
  schemaVersion: z.string(),
  /** Only set for TABLE_HTML: which table the artifact belongs to. */
  tableId: z.string().nullable(),
  createdAt: z.string(),
});
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const artifactIndexSchema = z.object({
  contractVersion: z.string(),
  artifacts: z.array(artifactRefSchema),
});
export type ArtifactIndex = z.infer<typeof artifactIndexSchema>;

export interface PersistArtifactsInput {
  accountId: string;
  documentId: string;
  processingRunId: string;
  /** The provider's own complete structured document. Stored verbatim. */
  canonical: unknown;
  normalized: NormalizedParserResult;
  quality: QualityAssessment;
}

/**
 * Writes every artifact a successful run produces, and returns the index.
 *
 * Only artifacts that genuinely exist are written: a parse that produced no
 * Markdown gets no MARKDOWN artifact rather than an empty one, because an empty
 * artifact and a missing artifact mean different things to a reviewer.
 *
 * A storage failure aborts with ARTIFACT_STORAGE_FAILED (retryable) rather than
 * being swallowed — a run whose artifacts are half-written must not be accepted.
 */
export async function persistRunArtifacts(input: PersistArtifactsInput): Promise<ArtifactIndex> {
  const artifacts: ArtifactRef[] = [];
  const now = new Date().toISOString();

  const write = async (params: {
    artifactType: ArtifactType;
    name: string;
    contentType: string;
    body: Buffer;
    tableId?: string;
  }): Promise<void> => {
    try {
      const stored = await storeProcessingArtifact({
        accountId: input.accountId,
        documentId: input.documentId,
        processingRunId: input.processingRunId,
        name: params.name,
        contentType: params.contentType,
        body: params.body,
      });
      artifacts.push({
        artifactType: params.artifactType,
        storageRef: stored.url,
        mimeType: params.contentType,
        byteSize: stored.size,
        sha256: stored.checksum,
        schemaVersion: QUBERE_PARSER_CONTRACT_VERSION,
        tableId: params.tableId ?? null,
        createdAt: now,
      });
    } catch (error) {
      throw new DocumentParserError(
        "ARTIFACT_STORAGE_FAILED",
        `Failed to persist the ${params.artifactType} artifact for this processing run.`,
        { retryable: true, cause: error }
      );
    }
  };

  // The canonical parser payload. Authoritative; everything else is derivative.
  await write({
    artifactType: "DOCLING_JSON",
    name: "parser-canonical.json",
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(input.canonical), "utf8"),
  });

  // Qubere's normalisation of it — re-derivable, but stored so a context can be
  // rebuilt without re-reading and re-adapting the vendor payload.
  await write({
    artifactType: "NORMALIZED_JSON",
    name: "parser-normalized.json",
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(input.normalized), "utf8"),
  });

  if (input.normalized.markdown !== null && input.normalized.markdown.trim() !== "") {
    await write({
      artifactType: "MARKDOWN",
      name: "document.md",
      contentType: "text/markdown",
      body: Buffer.from(input.normalized.markdown, "utf8"),
    });
  }

  if (input.normalized.tables.length > 0) {
    await write({
      artifactType: "TABLES_JSON",
      name: "tables.json",
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(input.normalized.tables), "utf8"),
    });

    for (const table of input.normalized.tables) {
      if (table.html === null) continue;
      await write({
        artifactType: "TABLE_HTML",
        name: `table-${table.id}.html`,
        contentType: "text/html",
        body: Buffer.from(table.html, "utf8"),
        tableId: table.id,
      });
    }
  }

  await write({
    artifactType: "QUALITY_REPORT",
    name: "quality.json",
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(input.quality), "utf8"),
  });

  const index: ArtifactIndex = { contractVersion: QUBERE_PARSER_CONTRACT_VERSION, artifacts };

  // One artifact per (run, type) except TABLE_HTML, which is per (run, table).
  const keys = artifacts.map((a) => `${a.artifactType}:${a.tableId ?? ""}`);
  if (new Set(keys).size !== keys.length) {
    throw new DocumentParserError(
      "ARTIFACT_STORAGE_FAILED",
      "Duplicate artifact detected for this processing run.",
      { retryable: false }
    );
  }

  return artifactIndexSchema.parse(index);
}

/** Reads the artifact index off a stored run, or null when there is none. */
export function parseArtifactIndex(raw: unknown): ArtifactIndex | null {
  if (raw === null || raw === undefined) return null;
  const parsed = artifactIndexSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function findArtifact(
  index: ArtifactIndex,
  artifactType: ArtifactType,
  tableId?: string
): ArtifactRef | null {
  return (
    index.artifacts.find(
      (artifact) =>
        artifact.artifactType === artifactType &&
        (tableId === undefined || artifact.tableId === tableId)
    ) ?? null
  );
}

/**
 * Reads back the normalised parser result for a run.
 *
 * Used to rebuild a QubereDocumentContext on demand without re-calling the
 * provider — a completed parse is paid for once.
 */
export async function loadNormalizedResult(index: ArtifactIndex): Promise<NormalizedParserResult> {
  const ref = findArtifact(index, "NORMALIZED_JSON");
  if (ref === null) {
    throw new DocumentParserError(
      "PARSER_RESULT_INCOMPLETE",
      "This processing run has no normalised parser artifact, so no document context can be built from it.",
      { retryable: false }
    );
  }

  const body = await readProcessingArtifact(ref.storageRef);
  const { parserResultSchema } = await import("./contracts");
  const parsed = parserResultSchema.safeParse(JSON.parse(body.toString("utf8")));
  if (!parsed.success) {
    throw new DocumentParserError(
      "PARSER_RESULT_INVALID",
      "The stored normalised parser artifact no longer matches the Qubere parser contract.",
      { retryable: false }
    );
  }
  return parsed.data;
}

/** Table id -> opaque artifact reference, for embedding in a document context. */
export function tableHtmlRefs(index: ArtifactIndex): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const artifact of index.artifacts) {
    if (artifact.artifactType === "TABLE_HTML" && artifact.tableId !== null) {
      // An opaque handle, not the storage location: contexts are handed to
      // models, and a storage reference in a prompt is a leaked storage key.
      refs[artifact.tableId] = `artifact:${artifact.artifactType}:${artifact.tableId}`;
    }
  }
  return refs;
}
