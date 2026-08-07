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
]);

// QPR-004: Configurable file size limit (default 50 MB).
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? "", 10) || 50 * 1024 * 1024;

export interface StorageUploadResult {
  url: string;
  filename: string;
  size: number;
  /** SHA-256 hex digest of the file content for integrity verification. */
  checksum: string;
  provider: "vercel-blob" | "local-fs";
}

export class StorageValidationError extends Error {
  constructor(
    public readonly code: "MIME_TYPE_NOT_ALLOWED" | "FILE_TOO_LARGE",
    message: string
  ) {
    super(message);
    this.name = "StorageValidationError";
  }
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

  // Provider 1: Vercel Blob Storage
  if (token) {
    try {
      console.log(`[Storage] Uploading ${filename} (${file.size} bytes) sha256=${checksum} to Vercel Blob Storage...`);
      const blob = await put(`documents/${Date.now()}-${filename}`, buffer, {
        access: "public",
        token,
      });

      return {
        url: blob.url,
        filename,
        size: file.size,
        checksum,
        provider: "vercel-blob",
      };
    } catch (err) {
      console.warn("[Storage] Vercel Blob upload failed, falling back to local storage:", err);
    }
  }

  // Provider 2: Local Filesystem Storage with Serverless /tmp Fallback
  let uploadDir = path.join(process.cwd(), "public", "uploads");
  let isTmpFallback = false;

  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (dirErr) {
    // Serverless environments (Vercel, AWS Lambda at /var/task) have read-only execution bundles.
    // Fall back to os.tmpdir() (/tmp/uploads) which is guaranteed to be writable in serverless lambdas.
    console.warn("[Storage] Public uploads directory unwritable in serverless environment, falling back to /tmp/uploads:", dirErr);
    uploadDir = path.join(os.tmpdir(), "uploads");
    isTmpFallback = true;
    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    } catch (tmpErr) {
      console.error("[Storage] Failed to create /tmp/uploads directory:", tmpErr);
    }
  }

  try {
    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const filePath = path.join(uploadDir, safeFilename);

    fs.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/${safeFilename}`;

    console.log(`[Storage] Saved ${filename} ${isTmpFallback ? "to serverless /tmp" : "locally"} at ${publicUrl} sha256=${checksum}`);

    return {
      url: publicUrl,
      filename,
      size: file.size,
      checksum,
      provider: "local-fs",
    };
  } catch (err) {
    console.error("[Storage] Filesystem write error:", err);
    throw new Error(`[Storage] Failed to persist file "${filename}" to storage provider. ${err}`);
  }
}
