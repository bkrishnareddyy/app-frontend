import { put } from "@vercel/blob";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// QPR-004: Allowlisted MIME types for customs document uploads.
// Only structured document formats acceptable for trade records.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/tiff",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
]);

// QPR-004: Configurable file size limit (default 50 MB).
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? "", 10) || 50 * 1024 * 1024;

/**
 * Hostnames whose objects may be fetched server-side with storage credentials.
 * Matched on the parsed hostname, never on raw substrings of the URL.
 */
const ALLOWED_STORAGE_HOSTS = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
  "storage.qubere.ai",
];

export type RemoteStorageOrigin = "vercel-blob";

/**
 * Resolves a stored file URL to a trusted remote storage origin.
 *
 * Returns `null` for values that are not remote allowlisted objects (for example
 * local `/uploads/...` paths), and throws for anything that looks remote but is
 * not allowlisted. Credentials must only ever be attached when this returns a
 * non-null origin.
 */
export function resolveStorageOrigin(fileUrl: string): RemoteStorageOrigin | null {
  if (fileUrl.startsWith("/")) return null;

  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new StorageValidationError("UNTRUSTED_STORAGE_ORIGIN", `Malformed storage URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new StorageValidationError("UNTRUSTED_STORAGE_ORIGIN", `Storage URL must use https.`);
  }

  const host = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_STORAGE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );

  if (!isAllowed) {
    throw new StorageValidationError(
      "UNTRUSTED_STORAGE_ORIGIN",
      `Storage host "${host}" is not an allowlisted storage origin.`
    );
  }

  return "vercel-blob";
}

export interface StorageUploadResult {
  url: string;
  filename: string;
  size: number;
  /** SHA-256 hex digest of the file content for integrity verification. */
  checksum: string;
  provider: "vercel-blob" | "local-fs";
}

/**
 * Asserts that a URL points at Qubere-controlled object storage.
 *
 * Call this before handing any URL to an external parser. Passing a
 * client-supplied URL to a provider that will fetch it makes the provider a
 * confused deputy, so the only URLs allowed out are ones Qubere minted against
 * its own allowlisted storage hosts.
 */
export function assertQubereStorageUrl(fileUrl: string): void {
  const origin = resolveStorageOrigin(fileUrl);
  if (origin === null) {
    throw new StorageValidationError(
      "UNTRUSTED_STORAGE_ORIGIN",
      "Only an absolute Qubere object-storage URL may be handed to an external parser."
    );
  }
}

export class StorageValidationError extends Error {
  constructor(
    public readonly code:
      | "MIME_TYPE_NOT_ALLOWED"
      | "FILE_TOO_LARGE"
      | "UNTRUSTED_STORAGE_ORIGIN",
    message: string
  ) {
    super(message);
    this.name = "StorageValidationError";
  }
}

/**
 * Writes a derived processing artifact (parser JSON, Markdown, table HTML, a
 * quality report) to object storage under a tenant/document/run path, so one
 * tenant's artifacts are never colocated with another's and a run's outputs can
 * be enumerated or lifecycled as a unit.
 *
 * Separate from `storeDocumentFile` on purpose: that function enforces the
 * upload MIME allowlist, which describes what a *customer* may upload and has
 * nothing to say about what Qubere itself generates.
 */
export async function storeProcessingArtifact(params: {
  accountId: string;
  documentId: string;
  processingRunId: string;
  /** Short artifact name, e.g. "docling.json". Sanitised before use. */
  name: string;
  contentType: string;
  body: Buffer;
}): Promise<StorageUploadResult> {
  const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const objectPath = [
    "processing",
    safeSegment(params.accountId),
    safeSegment(params.documentId),
    safeSegment(params.processingRunId),
    safeSegment(params.name),
  ].join("/");

  const checksum = createHash("sha256").update(params.body).digest("hex");
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (token) {
    const blob = await put(objectPath, params.body, {
      access: "private",
      contentType: params.contentType,
      token,
      // Artifact paths are already unique per run; a random suffix would break
      // the "one artifact per run per type" uniqueness rule.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return {
      url: blob.url,
      filename: params.name,
      size: params.body.byteLength,
      checksum,
      provider: "vercel-blob",
    };
  }

  const isServerless = Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.cwd().startsWith("/var/task")
  );
  if (isServerless) {
    throw new Error(
      "[Storage] BLOB_READ_WRITE_TOKEN is required to persist processing artifacts in a serverless environment."
    );
  }

  // Local development: artifacts are kept outside `public/` because, unlike an
  // uploaded document, they are not served through the tenant-scoped proxy.
  const artifactRoot = path.join(process.cwd(), ".qubere", "artifacts");
  const target = path.join(artifactRoot, objectPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, params.body);

  return {
    url: `file://${target}`,
    filename: params.name,
    size: params.body.byteLength,
    checksum,
    provider: "local-fs",
  };
}

/** Reads back an artifact previously written by `storeProcessingArtifact`. */
export async function readProcessingArtifact(storageRef: string): Promise<Buffer> {
  if (storageRef.startsWith("file://")) {
    const localPath = storageRef.slice("file://".length);
    const artifactRoot = path.join(process.cwd(), ".qubere", "artifacts");
    const resolved = path.resolve(localPath);
    // Confine reads to the artifact root so a tampered storage reference cannot
    // turn this into an arbitrary file read.
    if (!resolved.startsWith(artifactRoot + path.sep)) {
      throw new StorageValidationError(
        "UNTRUSTED_STORAGE_ORIGIN",
        "Artifact reference points outside the artifact store."
      );
    }
    return fs.readFileSync(resolved);
  }

  assertQubereStorageUrl(storageRef);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const response = await fetch(storageRef, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`[Storage] Failed to read artifact (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function storeDocumentFile(
  file: File,
  filename: string
): Promise<StorageUploadResult> {
  // QPR-004: Enforce MIME type allowlist before doing anything with the file.
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new StorageValidationError(
      "MIME_TYPE_NOT_ALLOWED",
      `File type "${file.type}" is not allowed. Accepted types: ${[...ALLOWED_MIME_TYPES].join(", ")}`
    );
  }

  // QPR-004: Enforce file size limit.
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new StorageValidationError(
      "FILE_TOO_LARGE",
      `File size ${file.size} bytes exceeds the maximum allowed ${MAX_UPLOAD_BYTES} bytes (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // QPR-004: Compute SHA-256 checksum for integrity verification and duplicate detection.
  const checksum = createHash("sha256").update(buffer).digest("hex");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const isServerless = Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.cwd().startsWith("/var/task")
  );

  const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

  // Provider 1: Vercel Blob Storage
  if (token) {
    try {
      console.log(`[Storage] Uploading ${safeFilename} (${file.size} bytes) sha256=${checksum} to Vercel Blob Storage...`);
      const blob = await put(`documents/${safeFilename}`, buffer, {
        access: "private",
        token,
      });

      return {
        url: blob.url,
        filename,
        size: file.size,
        checksum,
        provider: "vercel-blob",
      };
    } catch (err: unknown) {
      console.error("[Storage] Vercel Blob upload failed:", err);
      // In serverless environments, local filesystem is read-only.
      // Do not fall through silently; surface the Vercel Blob error directly.
      if (isServerless) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[Storage] Vercel Blob upload failed: ${message}`);
      }
    }
  } else if (isServerless) {
    throw new Error(`[Storage] BLOB_READ_WRITE_TOKEN environment variable is missing in Vercel production environment. Please set BLOB_READ_WRITE_TOKEN in Vercel Project Settings and redeploy.`);
  }

  // Provider 2: Local Filesystem Storage (For local development ONLY)
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filePath = path.join(uploadDir, safeFilename);
    fs.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/${safeFilename}`;

    console.log(`[Storage] Saved ${filename} locally at ${publicUrl} sha256=${checksum}`);

    return {
      url: publicUrl,
      filename,
      size: file.size,
      checksum,
      provider: "local-fs",
    };
  } catch (err: unknown) {
    try {
      const tmpDir = path.join(os.tmpdir(), "uploads");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      const tmpFilePath = path.join(tmpDir, safeFilename);
      fs.writeFileSync(tmpFilePath, buffer);
      console.log(`[Storage] Saved ${filename} to /tmp/uploads fallback`);
      return {
        url: `/uploads/${safeFilename}`,
        filename,
        size: file.size,
        checksum,
        provider: "local-fs",
      };
    } catch (tmpErr) {
      console.error("[Storage] Filesystem write error:", err, tmpErr);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[Storage] Failed to persist file "${filename}" to local storage. ${message}`);
    }
  }
}
