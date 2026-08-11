import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import {
  assertParseableFormat,
  readOriginalDocument,
  resolveMimeType,
} from "@/modules/documents/processing/documentSource";
import { DocumentParserError } from "@/modules/documents/parser/contracts";

/**
 * The original document is the ultimate source evidence, so reading it is the
 * only thing allowed to happen to it. These tests cover the fixtures that must
 * be rejected before a run is created (a retry can never fix them) and the
 * integrity check that fails a document whose stored bytes no longer match the
 * hash recorded at upload.
 */

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

/** A minimal born-digital PDF: header, a text object, and an EOF marker. */
function bornDigitalPdf(): Buffer {
  return Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
  );
}

/** A password-protected PDF: the trailer carries an /Encrypt dictionary. */
function encryptedPdf(): Buffer {
  return Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF\n"
  );
}

/** A truncated PDF: the EOF marker never arrives. */
function truncatedPdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Page >>\n${"x".repeat(200)}`);
}

describe("format gate", () => {
  it("accepts a born-digital PDF", () => {
    expect(() => assertParseableFormat(bornDigitalPdf())).not.toThrow();
  });

  it("rejects an encrypted PDF as never worth retrying", () => {
    // A valid file no parser can extract from. Retrying burns the attempt budget
    // and never succeeds, so it must fail closed at intake.
    const error = (() => {
      try {
        assertParseableFormat(encryptedPdf());
        return null;
      } catch (err) {
        return err as DocumentParserError;
      }
    })();
    expect(error?.code).toBe("PDF_ENCRYPTED");
    expect(error?.retryable).toBe(false);
  });

  it("rejects a truncated PDF", () => {
    const error = (() => {
      try {
        assertParseableFormat(truncatedPdf());
        return null;
      } catch (err) {
        return err as DocumentParserError;
      }
    })();
    expect(error?.code).toBe("PDF_CORRUPTED");
    expect(error?.retryable).toBe(false);
  });

  it("leaves non-PDF formats to the parser, since the PDF checks do not apply", () => {
    expect(() => assertParseableFormat(Buffer.from("plain text invoice"))).not.toThrow();
    // PNG magic bytes.
    expect(() =>
      assertParseableFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).not.toThrow();
  });
});

describe("MIME resolution", () => {
  it("prefers the type recorded at upload", () => {
    expect(resolveMimeType("application/pdf", "x.tiff")).toBe("application/pdf");
  });

  it("falls back to the extension when nothing was recorded", () => {
    expect(resolveMimeType(null, "invoice.PDF")).toBe("application/pdf");
    expect(resolveMimeType(null, "scan.tiff")).toBe("image/tiff");
    expect(resolveMimeType("", "photo.jpeg")).toBe("image/jpeg");
  });

  it("reports an unknown extension as a generic stream rather than guessing PDF", () => {
    expect(resolveMimeType(null, "mystery.zzz")).toBe("application/octet-stream");
  });
});

describe("reading the original", () => {
  const bytes = bornDigitalPdf();
  const sha = createHash("sha256").update(bytes).digest("hex");
  const url = "https://store.public.blob.vercel-storage.com/documents/inv.pdf";

  function stubStorage(body: Buffer, status = 200) {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(body), { status })) as typeof globalThis.fetch;
  }

  it("returns the bytes and their hash when the checksum matches", async () => {
    stubStorage(bytes);
    const result = await readOriginalDocument({ fileUrl: url, expectedSha256: sha });
    expect(result.sha256).toBe(sha);
    expect(result.bytes.equals(bytes)).toBe(true);
  });

  it("fails a document whose stored bytes no longer match the recorded hash", async () => {
    // A broken evidence chain is a hard failure, not a warning: this document can
    // no longer be treated as the original that was uploaded.
    stubStorage(Buffer.from("%PDF-1.7 different content\n%%EOF"));
    const error = await readOriginalDocument({ fileUrl: url, expectedSha256: sha }).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("INVALID_FILE");
    expect((error as DocumentParserError).retryable).toBe(false);
  });

  it("refuses a storage location that is not an allowlisted Qubere host", async () => {
    const error = await readOriginalDocument({
      fileUrl: "https://attacker.example.com/internal/secret",
      expectedSha256: null,
    }).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("SOURCE_FILE_UNAVAILABLE");
    expect((error as DocumentParserError).retryable).toBe(false);
  });

  it("reports a document with no stored file rather than parsing nothing", async () => {
    for (const fileUrl of [null, "", "   "]) {
      const error = await readOriginalDocument({ fileUrl, expectedSha256: null }).catch((e) => e);
      expect((error as DocumentParserError).code).toBe("SOURCE_FILE_UNAVAILABLE");
    }
  });

  it("treats a storage 5xx as retryable and a 404 as not", async () => {
    stubStorage(Buffer.alloc(0), 503);
    const transient = await readOriginalDocument({ fileUrl: url, expectedSha256: null }).catch((e) => e);
    expect((transient as DocumentParserError).retryable).toBe(true);

    stubStorage(Buffer.alloc(0), 404);
    const gone = await readOriginalDocument({ fileUrl: url, expectedSha256: null }).catch((e) => e);
    expect((gone as DocumentParserError).retryable).toBe(false);
  });

  it("rejects an empty stored file", async () => {
    stubStorage(Buffer.alloc(0));
    const error = await readOriginalDocument({ fileUrl: url, expectedSha256: null }).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("EMPTY_FILE");
    expect((error as DocumentParserError).retryable).toBe(false);
  });

  it("applies the format gate to what storage actually returned", async () => {
    stubStorage(encryptedPdf());
    const error = await readOriginalDocument({ fileUrl: url, expectedSha256: null }).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("PDF_ENCRYPTED");
  });
});
