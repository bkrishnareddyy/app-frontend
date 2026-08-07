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
    } catch (err: any) {
      console.error("[Storage] Vercel Blob upload failed:", err);
      // In serverless environments, local filesystem is read-only.
      // Do not fall through silently; surface the Vercel Blob error directly.
      if (isServerless) {
        throw new Error(`[Storage] Vercel Blob upload failed: ${err?.message || String(err)}`);
      }
    }
  } else if (isServerless) {
    throw new Error(`[Storage] BLOB_READ_WRITE_TOKEN environment variable is missing in Vercel production environment. Please set BLOB_READ_WRITE_TOKEN in Vercel Project Settings and redeploy.`);
  }

  // Provider 2: Local Filesystem Storage (For local development ONLY)
  let uploadDir = path.join(process.cwd(), "public", "uploads");

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
  } catch (err: any) {
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
      throw new Error(`[Storage] Failed to persist file "${filename}" to local storage. ${err?.message || err}`);
    }
  }
}
