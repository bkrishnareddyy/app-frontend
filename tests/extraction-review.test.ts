import { describe, it, expect } from "vitest";
import {
  buildReviewFields,
  nextReviewIndex,
  pagesWithFields,
  parseBoundingBox,
  validateCorrection,
  HUMAN_CORRECTION_SOURCE,
  type RawExtractionField,
} from "@/modules/documents/extractionReview";

function row(overrides: Partial<RawExtractionField> & { fieldName: string }): RawExtractionField {
  return {
    id: `f_${overrides.fieldName}_${overrides.createdAt ?? "0"}`,
    value: "v",
    confidence: 90,
    pageNumber: 1,
    bbox: null,
    source: "OCR_AI_AGENT",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseBoundingBox", () => {
  it("accepts a complete numeric box", () => {
    expect(parseBoundingBox({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("keeps a box anchored at the origin", () => {
    // A box at 0,0 is a real location. Falsiness checks lose it.
    expect(parseBoundingBox({ x: 0, y: 0, width: 5, height: 5 })).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
  });

  it("rejects a partial or non-numeric box rather than guessing", () => {
    expect(parseBoundingBox({ x: 1, y: 2, width: 3 })).toBeNull();
    expect(parseBoundingBox({ x: "1", y: 2, width: 3, height: 4 })).toBeNull();
    expect(parseBoundingBox(null)).toBeNull();
    expect(parseBoundingBox([1, 2, 3, 4])).toBeNull();
    expect(parseBoundingBox({ x: 1, y: 2, width: 0, height: 4 })).toBeNull();
  });
});

describe("buildReviewFields", () => {
  it("returns the machine reading when nothing has been corrected", () => {
    const [field] = buildReviewFields([
      row({ fieldName: "invoiceNumber", value: "INV-1", confidence: 95 }),
    ]);

    expect(field.currentValue).toBe("INV-1");
    expect(field.originalValue).toBe("INV-1");
    expect(field.corrected).toBe(false);
    expect(field.needsReview).toBe(false);
  });

  it("lets a human correction win over a higher-scoring machine read", () => {
    const [field] = buildReviewFields([
      row({ fieldName: "totalValue", value: "13400", confidence: 99 }),
      row({
        fieldName: "totalValue",
        value: "13,400.00",
        confidence: null,
        source: HUMAN_CORRECTION_SOURCE,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);

    expect(field.currentValue).toBe("13,400.00");
    expect(field.corrected).toBe(true);
    // The machine's reading is retained, not overwritten.
    expect(field.originalValue).toBe("13400");
    expect(field.confidence).toBe(99);
  });

  it("uses the newest correction when a field is corrected twice", () => {
    const [field] = buildReviewFields([
      row({ fieldName: "currency", value: "US", confidence: 40 }),
      row({
        fieldName: "currency",
        value: "USDD",
        source: HUMAN_CORRECTION_SOURCE,
        confidence: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      row({
        fieldName: "currency",
        value: "USD",
        source: HUMAN_CORRECTION_SOURCE,
        confidence: null,
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    ]);

    expect(field.currentValue).toBe("USD");
    expect(field.history).toHaveLength(3);
    expect(field.history.map((h) => h.value)).toEqual(["USD", "USDD", "US"]);
  });

  it("keeps every reading in the history, newest first", () => {
    const [field] = buildReviewFields([
      row({ fieldName: "shipper", value: "A", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ fieldName: "shipper", value: "B", createdAt: "2026-01-02T00:00:00.000Z" }),
    ]);

    expect(field.history.map((h) => h.value)).toEqual(["B", "A"]);
    expect(field.history.every((h) => h.isCorrection === false)).toBe(true);
  });

  it("flags an unscored field for review rather than treating it as confident", () => {
    const [field] = buildReviewFields([
      row({ fieldName: "consignee", confidence: null }),
    ]);

    expect(field.confidence).toBeNull();
    expect(field.needsReview).toBe(true);
  });

  it("flags a low-confidence field and clears the flag once corrected", () => {
    const [low] = buildReviewFields([row({ fieldName: "weight", confidence: 55 })]);
    expect(low.needsReview).toBe(true);

    const [fixed] = buildReviewFields([
      row({ fieldName: "weight", confidence: 55 }),
      row({
        fieldName: "weight",
        value: "1200",
        source: HUMAN_CORRECTION_SOURCE,
        confidence: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);
    expect(fixed.needsReview).toBe(false);
  });

  it("treats a zero-confidence reading as scored, not as unscored", () => {
    const [field] = buildReviewFields([row({ fieldName: "container", confidence: 0 })]);

    expect(field.confidence).toBe(0);
    expect(field.needsReview).toBe(true);
  });

  it("carries page and box provenance from the machine reading onto the correction", () => {
    const [field] = buildReviewFields([
      row({
        fieldName: "billNumber",
        pageNumber: 3,
        bbox: { x: 1, y: 2, width: 3, height: 4 },
        confidence: 70,
      }),
      row({
        fieldName: "billNumber",
        value: "BOL-9",
        source: HUMAN_CORRECTION_SOURCE,
        confidence: null,
        pageNumber: null,
        bbox: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);

    expect(field.pageNumber).toBe(3);
    expect(field.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("prefers the highest-scoring machine read among several", () => {
    const [field] = buildReviewFields([
      row({ fieldName: "quantity", value: "10", confidence: 60 }),
      row({
        fieldName: "quantity",
        value: "100",
        confidence: 92,
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);

    expect(field.currentValue).toBe("100");
    expect(field.confidence).toBe(92);
    // The first thing the extractor said is still what "original" means.
    expect(field.originalValue).toBe("10");
  });

  it("sorts fields by name so the review order is stable", () => {
    const fields = buildReviewFields([
      row({ fieldName: "zeta" }),
      row({ fieldName: "alpha" }),
      row({ fieldName: "mid" }),
    ]);

    expect(fields.map((f) => f.fieldName)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("returns nothing when the document has no extracted fields", () => {
    expect(buildReviewFields([])).toEqual([]);
  });
});

describe("pagesWithFields", () => {
  it("lists only pages that carry a located field, in order", () => {
    const fields = buildReviewFields([
      row({ fieldName: "a", pageNumber: 3 }),
      row({ fieldName: "b", pageNumber: 1 }),
      row({ fieldName: "c", pageNumber: 3 }),
      row({ fieldName: "d", pageNumber: null }),
    ]);

    expect(pagesWithFields(fields)).toEqual([1, 3]);
  });
});

describe("nextReviewIndex", () => {
  const fields = buildReviewFields([
    row({ fieldName: "a", confidence: 95 }),
    row({ fieldName: "b", confidence: 40 }),
    row({ fieldName: "c", confidence: 95 }),
    row({ fieldName: "d", confidence: null }),
  ]);

  it("moves to the next field that needs review", () => {
    expect(nextReviewIndex(fields, 0)).toBe(1);
  });

  it("wraps around to the first flagged field", () => {
    expect(nextReviewIndex(fields, 3)).toBe(1);
  });

  it("reports -1 when nothing needs review instead of moving focus", () => {
    const clean = buildReviewFields([
      row({ fieldName: "a", confidence: 95 }),
      row({ fieldName: "b", confidence: 90 }),
    ]);

    expect(nextReviewIndex(clean, 0)).toBe(-1);
  });

  it("reports -1 for an empty field set", () => {
    expect(nextReviewIndex([], 0)).toBe(-1);
  });
});

describe("validateCorrection", () => {
  it("accepts a trimmed replacement value", () => {
    expect(validateCorrection("  USD  ", "US")).toEqual({ ok: true, value: "USD" });
  });

  it("rejects a value that is not text", () => {
    expect(validateCorrection(42, "US").ok).toBe(false);
    expect(validateCorrection(null, "US").ok).toBe(false);
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(validateCorrection("   ", "US").ok).toBe(false);
  });

  it("rejects a value identical to the current reading", () => {
    expect(validateCorrection("USD", "USD")).toMatchObject({
      ok: false,
      reason: "The value is unchanged.",
    });
  });

  it("accepts the string \"0\", which is a real value", () => {
    expect(validateCorrection("0", "12")).toEqual({ ok: true, value: "0" });
  });

  it("rejects a value beyond the stored length", () => {
    expect(validateCorrection("x".repeat(2001), "y").ok).toBe(false);
  });
});
