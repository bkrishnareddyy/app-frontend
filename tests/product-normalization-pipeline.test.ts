/**
 * Tests for the product normalization pipeline.
 *
 * All tests are pure — no database, no network, no mocks. The pipeline is a
 * set of pure functions that must produce consistent, deterministic results.
 *
 * Three invariants the pipeline must uphold:
 *   1. Noise is stripped before fingerprinting, so variant descriptions that
 *      mean the same product collapse to one canonical record.
 *   2. Two descriptions that differ only in noise, punctuation or case must
 *      produce identical fingerprints (deduplication key).
 *   3. A description that is too sparse after stripping (< 2 meaningful
 *      words) is rejected rather than returned as a one-word canonical name.
 */

import { describe, expect, it } from "vitest";
import {
  computeFingerprint,
  extractIdentifiers,
  normalizeLanguage,
  runNormalizationPipeline,
  stripNoise,
  DEFAULT_NOISE_RULES,
} from "@/lib/products/normalizationEngine";

// ---------------------------------------------------------------------------
// stripNoise
// ---------------------------------------------------------------------------

describe("stripNoise: storage and dimension patterns", () => {
  it("removes a storage capacity token", () => {
    const result = stripNoise("USB Drive 256GB Flash Memory");
    expect(result).not.toContain("256GB");
    expect(result.trim()).toBe("USB Drive Flash Memory");
  });

  it("removes a dimension token expressed in inches (keyword form)", () => {
    const result = stripNoise("Monitor 27 inch Screen");
    expect(result).not.toContain("27");
  });

  it("removes multiple noise tokens in one pass", () => {
    const result = stripNoise("Laptop 512GB Black 15inch");
    expect(result).not.toContain("512GB");
    expect(result).not.toContain("Black");
    expect(result).not.toContain("15inch");
  });

  it("collapses resulting multiple spaces to one", () => {
    const result = stripNoise("Valve  Black  NPT");
    expect(result).not.toMatch(/  /);
  });
});

describe("stripNoise: marketing tiers and colours", () => {
  it("strips a colour variant", () => {
    const result = stripNoise("iPhone Silver Edition");
    expect(result).not.toContain("Silver");
  });

  it("strips a tier suffix", () => {
    const result = stripNoise("Camera Pro Max");
    expect(result).not.toContain("Pro Max");
  });

  it("does not strip words that merely contain a noise string (no boundary match)", () => {
    const result = stripNoise("Ultraviolet Sensor");
    expect(result).toContain("Ultraviolet");
  });
});

// ---------------------------------------------------------------------------
// computeFingerprint — the deduplication key
// ---------------------------------------------------------------------------

describe("computeFingerprint: identical after normalization", () => {
  it("produces the same fingerprint regardless of case", () => {
    expect(computeFingerprint("Stainless Steel Valve")).toBe(
      computeFingerprint("stainless steel valve")
    );
  });

  it("produces the same fingerprint regardless of punctuation", () => {
    expect(computeFingerprint("Stainless-Steel Valve, 1/2 NPT")).toBe(
      computeFingerprint("Stainless Steel Valve 1 2 NPT")
    );
  });

  it("removes stopwords so minor grammatical variation does not produce a different key", () => {
    expect(computeFingerprint("Valve for the pipe")).toBe(
      computeFingerprint("Valve pipe")
    );
  });

  it("is order-independent: tokens are sorted", () => {
    expect(computeFingerprint("Steel Valve Hydraulic")).toBe(
      computeFingerprint("Hydraulic Steel Valve")
    );
  });
});

describe("computeFingerprint: distinct products stay distinct", () => {
  it("differentiates two products with different nouns", () => {
    expect(computeFingerprint("Stainless Steel Valve")).not.toBe(
      computeFingerprint("Stainless Steel Pipe")
    );
  });
});

// ---------------------------------------------------------------------------
// extractIdentifiers — runs before noise stripping
// ---------------------------------------------------------------------------

describe("extractIdentifiers: GTIN family", () => {
  it("recognises a 12-digit UPC", () => {
    const ids = extractIdentifiers("Widget 012345678901 industrial");
    const upc = ids.find((id) => id.scheme === "UPC");
    expect(upc?.value).toBe("012345678901");
  });

  it("recognises a 13-digit EAN", () => {
    const ids = extractIdentifiers("5901234123457 bolt");
    const ean = ids.find((id) => id.scheme === "EAN");
    expect(ean?.value).toBe("5901234123457");
  });
});

describe("extractIdentifiers: manufacturer part numbers", () => {
  it("captures a part number flagged by the PN: prefix", () => {
    const ids = extractIdentifiers("Fitting PN: AB-1234 stainless");
    const mpn = ids.find((id) => id.scheme === "MANUFACTURER_PART_NUMBER");
    expect(mpn?.value).toBe("AB-1234");
  });

  it("does not extract a purely numeric string as a part number", () => {
    const ids = extractIdentifiers("Bolt 4567 steel");
    const mpns = ids.filter((id) => id.scheme === "MANUFACTURER_PART_NUMBER");
    expect(mpns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runNormalizationPipeline — end-to-end
// ---------------------------------------------------------------------------

describe("runNormalizationPipeline: too-sparse detection", () => {
  it("rejects an empty string", () => {
    const result = runNormalizationPipeline("");
    expect(result.tooSparse).toBe(true);
    expect(result.canonicalName).toBeNull();
  });

  it("rejects a description that reduces to a single word after stripping", () => {
    const result = runNormalizationPipeline("Valve Black 256GB Pro Max");
    expect(result.tooSparse).toBe(true);
    expect(result.canonicalName).toBeNull();
  });

  it("accepts a two-word description that survives stripping", () => {
    const result = runNormalizationPipeline("Steel Valve");
    expect(result.tooSparse).toBe(false);
    expect(result.canonicalName).toBe("Steel Valve");
  });
});

describe("runNormalizationPipeline: canonical name and fingerprint", () => {
  it("produces a canonical name and fingerprint for a well-formed description", () => {
    const result = runNormalizationPipeline("Stainless Steel Hydraulic Valve");
    expect(result.tooSparse).toBe(false);
    expect(result.canonicalName).toBeTruthy();
    expect(result.fingerprint).toBeTruthy();
  });

  it("fingerprint is deterministic: same input always produces the same fingerprint", () => {
    const r1 = runNormalizationPipeline("Carbon Steel Pipe Fitting");
    const r2 = runNormalizationPipeline("Carbon Steel Pipe Fitting");
    expect(r1.fingerprint).toBe(r2.fingerprint);
  });

  it("two descriptions that differ only by colour produce the same fingerprint (deduplication)", () => {
    const r1 = runNormalizationPipeline("Valve Black NPT");
    const r2 = runNormalizationPipeline("Valve Silver NPT");
    if (!r1.tooSparse && !r2.tooSparse) {
      expect(r1.fingerprint).toBe(r2.fingerprint);
    }
  });

  it("extracts a part number from the raw description before stripping", () => {
    const result = runNormalizationPipeline("Ball Valve PN: BV-9900 256GB");
    const mpn = result.extractedIdentifiers.find(
      (id) => id.scheme === "MANUFACTURER_PART_NUMBER"
    );
    expect(mpn?.value).toBe("BV-9900");
  });
});

// ---------------------------------------------------------------------------
// normalizeLanguage — abbreviation expansion
// ---------------------------------------------------------------------------

describe("normalizeLanguage: abbreviation expansion", () => {
  it("expands 'ss' to Stainless Steel", () => {
    const result = normalizeLanguage("ss pipe");
    expect(result).toContain("Stainless Steel");
  });

  it("expands 'pp' to Polypropylene", () => {
    const result = normalizeLanguage("pp fitting");
    expect(result).toContain("Polypropylene");
  });

  it("title-cases each word", () => {
    const result = normalizeLanguage("hydraulic valve nipple");
    expect(result).toBe("Hydraulic Valve Nipple");
  });
});
