/**
 * Reads the immutable original document back out of storage for parsing.
 *
 * The original is never modified, re-encoded, or re-written by any of this: it is
 * the ultimate source evidence, so it is only ever read. Reads are confined to
 * allowlisted storage origins (remote) or the uploads directory (local), and the
 * bytes are verified against the SHA-256 recorded at upload — a mismatch means
 * the evidence chain is broken and is a hard failure, not a warning.
 */

import { createHash } from "crypto";
import { DocumentParserError } from "../parser/contracts";
import { resolveStorageOrigin, StorageValidationError } from "@/lib/storage";

export interface DocumentBytes {
  bytes: Buffer;
  sha256: string;
}

/** Resolves a MIME type for the provider from what was recorded at upload. */
export function resolveMimeType(recorded: string | null, fileName: string): string {
  if (recorded !== null && recorded.trim() !== "") return recorded;

  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
  };
  return byExtension[extension] ?? "application/octet-stream";
}

export async function readOriginalDocument(params: {
  fileUrl: string | null;
  expectedSha256: string | null;
}): Promise<DocumentBytes> {
  if (params.fileUrl === null || params.fileUrl.trim() === "") {
    throw new DocumentParserError(
      "SOURCE_FILE_UNAVAILABLE",
      "This document has no stored file, so there is nothing to parse.",
      { retryable: false }
    );
  }

  let bytes: Buffer;
  try {
    const origin = resolveStorageOrigin(params.fileUrl);
    if (origin === null) {
      bytes = await readLocalUpload(params.fileUrl);
    } else {
      bytes = await readRemoteObject(params.fileUrl);
    }
  } catch (error) {
    if (error instanceof StorageValidationError) {
      throw new DocumentParserError(
        "SOURCE_FILE_UNAVAILABLE",
        "The document's storage location is not a trusted Qubere storage origin.",
        { retryable: false, cause: error }
      );
    }
    if (error instanceof DocumentParserError) throw error;
    throw new DocumentParserError(
      "SOURCE_FILE_UNAVAILABLE",
      "The stored document could not be read.",
      { retryable: true, cause: error }
    );
  }

  if (bytes.byteLength === 0) {
    throw new DocumentParserError("EMPTY_FILE", "The stored document is empty.", { retryable: false });
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (params.expectedSha256 !== null && params.expectedSha256 !== sha256) {
    throw new DocumentParserError(
      "INVALID_FILE",
      "The stored document does not match the checksum recorded at upload, so it cannot be treated as the original evidence.",
      { retryable: false }
    );
  }

  assertParseableFormat(bytes);
  return { bytes, sha256 };
}

/**
 * Rejects formats the parser cannot read, before paying to send them.
 *
 * An encrypted PDF is the important case: it is a perfectly valid file that no
 * parser can extract from, and retrying it forever would burn attempts. PDF
 * encryption is detectable from the trailer dictionary without decoding the file.
 */
export function assertParseableFormat(bytes: Buffer): void {
  const header = bytes.subarray(0, 5).toString("latin1");
  if (!header.startsWith("%PDF")) return;

  const tail = bytes.subarray(Math.max(0, bytes.byteLength - 4096)).toString("latin1");
  // An /Encrypt entry in the trailer is what makes a PDF password-protected.
  if (/\/Encrypt\b/.test(tail) || /\/Encrypt\b/.test(bytes.subarray(0, 4096).toString("latin1"))) {
    throw new DocumentParserError(
      "PDF_ENCRYPTED",
      "This PDF is encrypted or password-protected, so its contents cannot be extracted.",
      { retryable: false }
    );
  }

  // A PDF with no EOF marker anywhere in its tail is truncated.
  if (!tail.includes("%%EOF")) {
    throw new DocumentParserError(
      "PDF_CORRUPTED",
      "This PDF is missing its end-of-file marker and appears to be truncated.",
      { retryable: false }
    );
  }
}

async function readRemoteObject(fileUrl: string): Promise<Buffer> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const response = await fetch(fileUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    throw new DocumentParserError(
      "SOURCE_FILE_UNAVAILABLE",
      `The document could not be retrieved from storage (HTTP ${response.status}).`,
      // 4xx from storage means the object is gone; 5xx is worth another attempt.
      { retryable: response.status >= 500 }
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function readLocalUpload(fileUrl: string): Promise<Buffer> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  const resolved = path.resolve(uploadsRoot, path.basename(fileUrl));

  // Confined to the uploads directory so a crafted fileUrl cannot traverse.
  if (path.dirname(resolved) !== uploadsRoot || !fs.existsSync(resolved)) {
    throw new DocumentParserError(
      "SOURCE_FILE_UNAVAILABLE",
      "The locally stored document could not be found.",
      { retryable: false }
    );
  }
  return fs.readFileSync(resolved);
}
