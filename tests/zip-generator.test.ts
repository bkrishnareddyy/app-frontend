import { describe, it, expect } from "vitest";
import { generateZipBuffer, computeCrc32 } from "@/lib/zip/zipGenerator";

describe("zipGenerator — zero dependency PKZIP builder", () => {
  it("computes reproducible CRC32 checksums", () => {
    const data = Buffer.from("Hello Qubere Trade Engine", "utf-8");
    const crc = computeCrc32(data);
    expect(crc).toBeGreaterThan(0);
    expect(typeof crc).toBe("number");
  });

  it("generates a valid ZIP buffer with multiple entries", () => {
    const entries = [
      { filename: "doc1.txt", content: "Sample text document content" },
      { filename: "subfolder/doc2.json", content: JSON.stringify({ status: "OK", entryNumber: "123-456" }) },
      { filename: "pdf/stub.pdf", content: Buffer.from("%PDF-1.4 test stream", "utf-8") },
    ];

    const zipBuffer = generateZipBuffer(entries);
    expect(Buffer.isBuffer(zipBuffer)).toBe(true);
    expect(zipBuffer.length).toBeGreaterThan(100);

    // PKZIP header signature check
    const signature = zipBuffer.readUInt32LE(0);
    expect(signature).toBe(0x04034b50);
  });
});
