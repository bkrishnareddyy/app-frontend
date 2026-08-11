import { describe, it, expect } from "vitest";
import { assessQuality, qualifiesAsActive } from "@/modules/documents/parser/qualityGate";
import type { NormalizedParserResult } from "@/modules/documents/parser/contracts";

/**
 * The quality gate decides whether a parse is good enough to become a document's
 * active version. It must reach that decision from counts and parser-reported
 * flags only — never from an invented score — and it must distinguish "retry with
 * OCR" from "a person needs to look at this".
 */

function result(overrides: Partial<NormalizedParserResult> = {}): NormalizedParserResult {
  return {
    contractVersion: "qubere.parser/1",
    profile: "STANDARD",
    metadata: {
      provider: "IBM_DOCLING",
      parserName: "DoclingDocument",
      parserVersion: "1.3.0",
      ocrEngine: null,
      ocrEngineVersion: null,
      pageCount: 2,
      ocrUsed: null,
      fullPageOcrUsed: null,
      processingDurationMs: 3000,
      parserConfidence: null,
      ocrConfidence: null,
    },
    markdown: "# Invoice",
    sections: [
      {
        id: "sec_0000_aaaa",
        headingPath: ["Invoice"],
        content: "Invoice No: INV-1\nShipper: ACME GmbH\nConsignee: Target Imports LLC",
        provenance: [{ page: 1, bbox: null, elementRef: "#/texts/0" }],
      },
    ],
    tables: [],
    warnings: [],
    pageTextLengths: [400, 380],
    ...overrides,
  };
}

const CLEAN_INPUT = { expectedPageCount: null, isOcrRetry: false, usedFullPageOcr: false };

describe("quality gate outcomes", () => {
  it("passes a born-digital document with text on every page", () => {
    const assessment = assessQuality({ result: result(), ...CLEAN_INPUT });
    expect(assessment.outcome).toBe("PASS");
    expect(qualifiesAsActive(assessment.outcome)).toBe(true);
    expect(assessment.textCoverage).toBe(1);
  });

  it("does not invent a numeric quality confidence", () => {
    const assessment = assessQuality({ result: result(), ...CLEAN_INPUT });
    const keys = Object.keys(assessment);
    expect(keys).not.toContain("confidence");
    expect(keys).not.toContain("score");
    // Everything reported is a count, a measured ratio, or a parser-set flag.
    expect(assessment.pageCount).toBe(2);
    expect(assessment.totalTextLength).toBeGreaterThan(0);
  });

  it("always explains itself", () => {
    for (const scenario of [result(), result({ pageTextLengths: [0, 0] })]) {
      const assessment = assessQuality({ result: scenario, ...CLEAN_INPUT });
      expect(assessment.reasons.length).toBeGreaterThan(0);
      for (const reason of assessment.reasons) expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("preserves the parser's OCR flags rather than substituting its own", () => {
    const assessment = assessQuality({ result: result(), ...CLEAN_INPUT });
    expect(assessment.ocrUsed).toBeNull();
    expect(assessment.fullPageOcrUsed).toBeNull();
  });
});

describe("quality gate: OCR escalation", () => {
  it("retries a scanned document that yielded no text", () => {
    // The canonical image-only PDF: pages exist, no text came out.
    const assessment = assessQuality({
      result: result({ sections: [], tables: [], pageTextLengths: [0, 0] }),
      ...CLEAN_INPUT,
    });
    expect(assessment.outcome).toBe("RETRY_WITH_OCR");
    expect(assessment.suggestedRetryProfile).toBe("FULL_PAGE_OCR");
    expect(qualifiesAsActive(assessment.outcome)).toBe(false);
  });

  it("escalates gently first, then forces OCR on the second try", () => {
    const thin = result({
      sections: [
        {
          id: "s",
          headingPath: [],
          content: "x",
          provenance: [{ page: 1, bbox: null, elementRef: null }],
        },
      ],
      pageTextLengths: [5, 3, 2, 400],
      metadata: { ...result().metadata, pageCount: 4 },
    });

    const first = assessQuality({ result: thin, isOcrRetry: false, usedFullPageOcr: false, expectedPageCount: null });
    expect(first.outcome).toBe("RETRY_WITH_OCR");
    expect(first.suggestedRetryProfile).toBe("OCR_FALLBACK");

    const second = assessQuality({ result: thin, isOcrRetry: true, usedFullPageOcr: false, expectedPageCount: null });
    expect(second.suggestedRetryProfile).toBe("FULL_PAGE_OCR");
  });

  it("stops retrying and asks for a person once full-page OCR has already run", () => {
    // Looping OCR forever on a document OCR cannot read is how a queue silently
    // fills up. After FULL_PAGE_OCR, remaining gaps are not an OCR problem.
    const assessment = assessQuality({
      result: result({ sections: [], tables: [], pageTextLengths: [0, 0], profile: "FULL_PAGE_OCR" }),
      expectedPageCount: null,
      isOcrRetry: true,
      usedFullPageOcr: true,
    });
    expect(assessment.outcome).toBe("NEEDS_REVIEW");
    expect(assessment.suggestedRetryProfile).toBeNull();
    expect(assessment.reasons.join(" ")).toMatch(/already/i);
  });

  it("does not push a healthy born-digital parse down an OCR path", () => {
    const assessment = assessQuality({ result: result(), ...CLEAN_INPUT });
    expect(assessment.outcome).not.toBe("RETRY_WITH_OCR");
    expect(assessment.suggestedRetryProfile).toBeNull();
  });
});

describe("quality gate: warnings and partial results", () => {
  it("passes with warnings when some pages are blank but most carry text", () => {
    const assessment = assessQuality({
      result: result({ pageTextLengths: [500, 480, 520, 0], metadata: { ...result().metadata, pageCount: 4 } }),
      ...CLEAN_INPUT,
    });
    expect(assessment.outcome).toBe("PASS_WITH_WARNINGS");
    expect(assessment.blankPageCount).toBe(1);
    expect(qualifiesAsActive(assessment.outcome)).toBe(true);
  });

  it("sends a parse with a provider-reported error to review", () => {
    const assessment = assessQuality({
      result: result({
        warnings: [{ code: "PROVIDER_REPORTED_ERROR", message: "page 2 failed", page: 2 }],
      }),
      ...CLEAN_INPUT,
    });
    expect(assessment.outcome).toBe("NEEDS_REVIEW");
    expect(assessment.warningCodes).toContain("PROVIDER_REPORTED_ERROR");
  });

  it("sends a markdown-only parse to review rather than accepting it as clean", () => {
    const assessment = assessQuality({
      result: result({
        sections: [
          { id: "s", headingPath: [], content: "Invoice 1", provenance: [] },
        ],
        pageTextLengths: [],
        warnings: [{ code: "NO_STRUCTURED_DOCUMENT", message: "no json", page: null }],
        metadata: { ...result().metadata, pageCount: null },
      }),
      ...CLEAN_INPUT,
    });
    expect(assessment.outcome).toBe("NEEDS_REVIEW");
  });

  it("says page coverage is unknown rather than claiming a clean pass", () => {
    const assessment = assessQuality({
      result: result({ pageTextLengths: [], metadata: { ...result().metadata, pageCount: null } }),
      ...CLEAN_INPUT,
    });
    expect(assessment.outcome).toBe("PASS_WITH_WARNINGS");
    expect(assessment.textCoverage).toBeNull();
    expect(assessment.blankPageCount).toBeNull();
    expect(assessment.reasons.join(" ")).toMatch(/unknown/i);
  });

  it("reports a page-count disagreement with an independently known count", () => {
    const assessment = assessQuality({
      result: result(),
      expectedPageCount: 5,
      isOcrRetry: false,
      usedFullPageOcr: false,
    });
    expect(assessment.reasons.join(" ")).toMatch(/2 page\(s\) but 5 were expected/);
  });
});

describe("active-version eligibility", () => {
  it("only admits outcomes that actually cleared the gate", () => {
    expect(qualifiesAsActive("PASS")).toBe(true);
    expect(qualifiesAsActive("PASS_WITH_WARNINGS")).toBe(true);
    // A run awaiting an OCR retry has real artifacts but is not authoritative.
    expect(qualifiesAsActive("RETRY_WITH_OCR")).toBe(false);
    expect(qualifiesAsActive("NEEDS_REVIEW")).toBe(false);
    expect(qualifiesAsActive("FAILED")).toBe(false);
  });
});
