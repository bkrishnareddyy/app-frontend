import { describe, it, expect } from "vitest";
import { resolveStorageOrigin, StorageValidationError } from "@/lib/storage";

describe("Storage origin allowlist (file proxy hardening)", () => {
  it("accepts genuine Vercel Blob hosts", () => {
    expect(
      resolveStorageOrigin("https://abc123.public.blob.vercel-storage.com/documents/inv.pdf")
    ).toBe("vercel-blob");
    expect(resolveStorageOrigin("https://blob.vercel-storage.com/documents/inv.pdf")).toBe(
      "vercel-blob"
    );
  });

  it("treats local upload paths as non-remote so no credential is attached", () => {
    expect(resolveStorageOrigin("/uploads/1234-invoice.pdf")).toBeNull();
  });

  it("rejects hosts that merely contain the allowlisted domain as a substring", () => {
    // These all passed the previous `url.includes("vercel-storage.com")` check
    // and would have leaked BLOB_READ_WRITE_TOKEN to the attacker.
    const bypasses = [
      "https://attacker.com/vercel-storage.com",
      "https://attacker.com/?x=vercel-storage.com",
      "https://vercel-storage.com.attacker.com/steal",
      "https://attacker.com#vercel-storage.com",
    ];

    for (const url of bypasses) {
      expect(() => resolveStorageOrigin(url), url).toThrow(StorageValidationError);
    }
  });

  it("rejects non-https schemes and internal metadata endpoints", () => {
    expect(() => resolveStorageOrigin("http://blob.vercel-storage.com/x")).toThrow(
      StorageValidationError
    );
    expect(() => resolveStorageOrigin("http://169.254.169.254/latest/meta-data/")).toThrow(
      StorageValidationError
    );
    expect(() => resolveStorageOrigin("file:///etc/passwd")).toThrow(StorageValidationError);
  });

  it("rejects malformed URLs", () => {
    expect(() => resolveStorageOrigin("not a url")).toThrow(StorageValidationError);
  });
});
