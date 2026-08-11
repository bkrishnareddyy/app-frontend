/**
 * Document quality gate.
 *
 * Decides, from objective signals only, whether a parse is good enough to be the
 * document's active version. There are no invented percentages here: every input
 * is a count, a flag the parser actually set, or a warning the parser actually
 * emitted. A judgement is expressed as an outcome plus the reasons that produced
 * it, so a reviewer sees *why* a document is being held rather than a score.
 *
 * Pure and database-free, so the policy can be tested directly.
 */

import { z } from "zod";
import type { NormalizedParserResult } from "./contracts";

export const QUALITY_OUTCOMES = [
  "PASS",
  "PASS_WITH_WARNINGS",
  "RETRY_WITH_OCR",
  "NEEDS_REVIEW",
  "FAILED",
] as const;
export type QualityOutcome = (typeof QUALITY_OUTCOMES)[number];

/**
 * A page with fewer than this many extracted characters is "low text".
 *
 * Chosen because a customs document page carrying only a stamp, a signature, or
 * a scan artefact lands well below it, while even a sparse continuation page of
 * a packing list clears it. It is a threshold on a measured count, not a
 * confidence score.
 */
const LOW_TEXT_PAGE_CHARS = 40;

/** A page with no extracted characters at all. */
const BLANK_PAGE_CHARS = 0;

/**
 * Fraction of pages that must carry meaningful text for a parse to pass without
 * an OCR retry. Below this, the text layer is presumed insufficient.
 */
const MIN_TEXT_COVERAGE = 0.6;

export const qualityAssessmentSchema = z.object({
  outcome: z.enum(QUALITY_OUTCOMES),
  pageCount: z.number().int().nonnegative().nullable(),
  /** Fraction of pages carrying more than LOW_TEXT_PAGE_CHARS. Null when page data is absent. */
  textCoverage: z.number().min(0).max(1).nullable(),
  blankPageCount: z.number().int().nonnegative().nullable(),
  lowTextPageCount: z.number().int().nonnegative().nullable(),
  tableCount: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
  totalTextLength: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  /** Codes of parser warnings that influenced the outcome. */
  warningCodes: z.array(z.string()),
  /** As reported by the parser. Null means the parser did not say. */
  ocrUsed: z.boolean().nullable(),
  fullPageOcrUsed: z.boolean().nullable(),
  /** Human-readable, specific reasons for the outcome. */
  reasons: z.array(z.string()),
  /** Profile Qubere should use if the outcome is RETRY_WITH_OCR. */
  suggestedRetryProfile: z.enum(["OCR_FALLBACK", "FULL_PAGE_OCR"]).nullable(),
  assessedAt: z.string(),
});
export type QualityAssessment = z.infer<typeof qualityAssessmentSchema>;

export interface QualityGateInput {
  result: NormalizedParserResult;
  /** How many pages Qubere expected, when known independently of the parser. */
  expectedPageCount?: number | null;
  /** True when this run is already an OCR retry, so we do not loop forever. */
  isOcrRetry: boolean;
  /** True when the run already used full-page OCR. */
  usedFullPageOcr: boolean;
}

/**
 * Warning codes that mean the parse is materially incomplete rather than merely
 * imperfect, so a human has to look at the document.
 */
const REVIEW_WARNING_CODES = new Set([
  "NO_STRUCTURED_DOCUMENT",
  "IMAGE_ONLY_RESULT",
  "PROVIDER_REPORTED_ERROR",
]);

export function assessQuality(input: QualityGateInput): QualityAssessment {
  const { result } = input;
  const pageLengths = result.pageTextLengths;
  const hasPageData = pageLengths.length > 0;

  const totalTextLength =
    result.sections.reduce((sum, section) => sum + section.content.length, 0) +
    result.tables.reduce(
      (sum, table) => sum + table.cells.reduce((cellSum, cell) => cellSum + cell.text.length, 0),
      0
    );

  const blankPageCount = hasPageData
    ? pageLengths.filter((length) => length === BLANK_PAGE_CHARS).length
    : null;
  const lowTextPageCount = hasPageData
    ? pageLengths.filter((length) => length < LOW_TEXT_PAGE_CHARS).length
    : null;
  const textCoverage =
    hasPageData && lowTextPageCount !== null
      ? (pageLengths.length - lowTextPageCount) / pageLengths.length
      : null;

  const warningCodes = [...new Set(result.warnings.map((w) => w.code))];
  const reasons: string[] = [];

  const pageCount = result.metadata.pageCount;

  // ---- Hard failures: nothing usable came back at all. -------------------
  if (result.sections.length === 0 && result.tables.length === 0) {
    reasons.push("The parser returned no text sections and no tables.");
    const canRetry = !input.usedFullPageOcr;
    return {
      outcome: canRetry ? "RETRY_WITH_OCR" : "NEEDS_REVIEW",
      pageCount,
      textCoverage,
      blankPageCount,
      lowTextPageCount,
      tableCount: result.tables.length,
      sectionCount: result.sections.length,
      totalTextLength,
      warningCount: result.warnings.length,
      warningCodes,
      ocrUsed: result.metadata.ocrUsed,
      fullPageOcrUsed: result.metadata.fullPageOcrUsed,
      reasons: canRetry
        ? [...reasons, "Retrying with OCR because no text layer was recovered."]
        : [
            ...reasons,
            "Full-page OCR has already been attempted, so this document needs a person to look at it.",
          ],
      suggestedRetryProfile: canRetry ? "FULL_PAGE_OCR" : null,
      assessedAt: new Date().toISOString(),
    };
  }

  // ---- Page-count disagreement -------------------------------------------
  if (
    input.expectedPageCount !== null &&
    input.expectedPageCount !== undefined &&
    pageCount !== null &&
    pageCount !== input.expectedPageCount
  ) {
    reasons.push(
      `The parser reported ${pageCount} page(s) but ${input.expectedPageCount} were expected.`
    );
  }

  // ---- Insufficient text coverage ---------------------------------------
  let outcome: QualityOutcome = "PASS";
  let suggestedRetryProfile: "OCR_FALLBACK" | "FULL_PAGE_OCR" | null = null;

  if (textCoverage !== null && textCoverage < MIN_TEXT_COVERAGE) {
    reasons.push(
      `Only ${Math.round(textCoverage * 100)}% of pages carried more than ${LOW_TEXT_PAGE_CHARS} characters of text.`
    );
    if (input.usedFullPageOcr) {
      outcome = "NEEDS_REVIEW";
      reasons.push("Full-page OCR has already run, so remaining gaps are not an OCR problem.");
    } else {
      outcome = "RETRY_WITH_OCR";
      // The first retry escalates gently; a second escalates to forcing OCR on
      // pages that already claim a text layer.
      suggestedRetryProfile = input.isOcrRetry ? "FULL_PAGE_OCR" : "OCR_FALLBACK";
      reasons.push(
        `Retrying with the ${suggestedRetryProfile} profile because the recovered text layer is insufficient.`
      );
    }
  }

  // ---- Warnings that demand review --------------------------------------
  const reviewWarnings = warningCodes.filter((code) => REVIEW_WARNING_CODES.has(code));
  if (reviewWarnings.length > 0 && outcome !== "RETRY_WITH_OCR") {
    outcome = "NEEDS_REVIEW";
    reasons.push(`The parser raised warning(s) that need review: ${reviewWarnings.join(", ")}.`);
  }

  // ---- Blank pages ------------------------------------------------------
  if (blankPageCount !== null && blankPageCount > 0 && outcome === "PASS") {
    outcome = "PASS_WITH_WARNINGS";
    reasons.push(`${blankPageCount} page(s) yielded no text at all.`);
  }

  if (outcome === "PASS" && result.warnings.length > 0) {
    outcome = "PASS_WITH_WARNINGS";
    reasons.push(`The parser emitted ${result.warnings.length} non-fatal warning(s).`);
  }

  if (!hasPageData && outcome === "PASS") {
    // Content came back but the parser attributed none of it to pages, so
    // page-level quality is simply unknown. Saying so beats claiming a clean pass.
    outcome = "PASS_WITH_WARNINGS";
    reasons.push("The parser reported no per-page information, so page coverage is unknown.");
  }

  if (reasons.length === 0) {
    reasons.push(
      `Text recovered from ${pageCount ?? pageLengths.length} page(s) with ${result.tables.length} structured table(s).`
    );
  }

  return {
    outcome,
    pageCount,
    textCoverage,
    blankPageCount,
    lowTextPageCount,
    tableCount: result.tables.length,
    sectionCount: result.sections.length,
    totalTextLength,
    warningCount: result.warnings.length,
    warningCodes,
    ocrUsed: result.metadata.ocrUsed,
    fullPageOcrUsed: result.metadata.fullPageOcrUsed,
    reasons,
    suggestedRetryProfile,
    assessedAt: new Date().toISOString(),
  };
}

/**
 * Whether a run with this outcome may become the document's active version.
 *
 * RETRY_WITH_OCR deliberately does not qualify: the run's artifacts are kept for
 * audit, but a better run is expected to supersede it.
 */
export function qualifiesAsActive(outcome: QualityOutcome): boolean {
  return outcome === "PASS" || outcome === "PASS_WITH_WARNINGS";
}
