/**
 * Filing readiness, computed from what the shipment record actually holds.
 *
 * The Filing Readiness Agent scores a pipeline run from flags the caller passes
 * in. That is fine for a pipeline, but it cannot answer the question a broker
 * asks while looking at a shipment: can this entry be filed right now, and if
 * not, what is missing? This module answers that from stored columns only.
 *
 * Every check here is a check that is genuinely performed. There is deliberately
 * no bond check, no PGA check and no licence check, because no column carries
 * the answer — claiming to have verified them would be worse than not listing
 * them at all.
 */

export type FilingBlockerCode =
  | "NO_LINE_ITEMS"
  | "MISSING_HTS_CLASSIFICATION"
  | "MISSING_COUNTRY_OF_ORIGIN"
  | "MISSING_COMMERCIAL_INVOICE"
  | "MISSING_IMPORTER_OF_RECORD"
  | "MISSING_ENTRY_TYPE"
  | "BLOCKING_EXCEPTIONS"
  | "CRITICAL_RECONCILIATION";

export interface FilingBlocker {
  code: FilingBlockerCode;
  /** What was checked, phrased as the requirement. */
  label: string;
  /** What the record actually holds, with counts rather than adjectives. */
  detail: string;
  /** Where the reader goes to fix it, relative to the shipment workspace. */
  anchor: string;
}

export interface ReadinessLineItem {
  lineNumber: number;
  htsCode: string | null;
  countryOfOrigin: string | null;
}

export interface ReadinessDocument {
  docType: string;
  status: string;
}

export interface ReadinessException {
  severity: string;
}

export interface ReadinessReconciliationIssue {
  severity: string;
}

export interface FilingReadinessSubject {
  importerOfRecordId: string | null;
  entryType: string | null;
  lineItems: ReadinessLineItem[];
  documents: ReadinessDocument[];
  openExceptions: ReadinessException[];
  openReconciliationIssues: ReadinessReconciliationIssue[];
}

export interface FilingReadinessResult {
  ready: boolean;
  blockers: FilingBlocker[];
  /**
   * How many checks this module actually ran, so the UI never implies more.
   * A shipment with no lines cannot be checked for classification or origin,
   * and reporting those as passed would be a fabrication.
   */
  checksPerformed: number;
  checksPassed: number;
}

/** The most checks that can run: every check below, when there is a line to check. */
export const FILING_READINESS_MAX_CHECKS = 8;

const BLOCKING_EXCEPTION_SEVERITIES = ["Critical", "High"];

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** A US entry needs a 10-digit HTS number. Formatting dots do not count. */
export function isTenDigitHts(value: string | null | undefined): boolean {
  if (!present(value)) return false;
  return value!.replace(/\D/g, "").length === 10;
}

function isCommercialInvoice(doc: ReadinessDocument): boolean {
  return (
    doc.docType.toLowerCase().includes("commercial invoice") &&
    doc.status.toLowerCase() !== "missing"
  );
}

function plural(count: number, singular: string, pluralWord: string): string {
  return count === 1 ? singular : pluralWord;
}

export function evaluateFilingReadiness(
  subject: FilingReadinessSubject
): FilingReadinessResult {
  const blockers: FilingBlocker[] = [];
  // Incremented by each check as it runs, not assumed up front.
  let performed = 0;

  performed += 1;
  if (subject.lineItems.length === 0) {
    blockers.push({
      code: "NO_LINE_ITEMS",
      label: "At least one line item",
      detail: "This shipment has no line items, so there is nothing to declare.",
      anchor: "#line-items",
    });
  } else {
    performed += 1;
    const unclassified = subject.lineItems.filter((li) => !isTenDigitHts(li.htsCode));
    if (unclassified.length > 0) {
      blockers.push({
        code: "MISSING_HTS_CLASSIFICATION",
        label: "A 10-digit HTS number on every line",
        detail: `${unclassified.length} of ${subject.lineItems.length} ${plural(
          subject.lineItems.length,
          "line",
          "lines"
        )} has no 10-digit classification: ${unclassified
          .map((li) => `line ${li.lineNumber}`)
          .join(", ")}.`,
        anchor: "#line-items",
      });
    }

    performed += 1;
    const originless = subject.lineItems.filter((li) => !present(li.countryOfOrigin));
    if (originless.length > 0) {
      blockers.push({
        code: "MISSING_COUNTRY_OF_ORIGIN",
        label: "A country of origin on every line",
        detail: `${originless.length} of ${subject.lineItems.length} ${plural(
          subject.lineItems.length,
          "line",
          "lines"
        )} names no country of origin: ${originless
          .map((li) => `line ${li.lineNumber}`)
          .join(", ")}.`,
        anchor: "#line-items",
      });
    }
  }

  performed += 1;
  if (!subject.documents.some(isCommercialInvoice)) {
    blockers.push({
      code: "MISSING_COMMERCIAL_INVOICE",
      label: "A commercial invoice on file (19 CFR 141.86)",
      detail:
        subject.documents.length === 0
          ? "No documents have been received for this shipment."
          : `None of the ${subject.documents.length} ${plural(
              subject.documents.length,
              "document",
              "documents"
            )} on file is a received commercial invoice.`,
      anchor: "#documents",
    });
  }

  performed += 1;
  if (!present(subject.importerOfRecordId)) {
    blockers.push({
      code: "MISSING_IMPORTER_OF_RECORD",
      label: "An importer of record",
      detail: "No importer of record is linked to this shipment.",
      anchor: "#overview",
    });
  }

  performed += 1;
  if (!present(subject.entryType)) {
    blockers.push({
      code: "MISSING_ENTRY_TYPE",
      label: "An entry type",
      detail: "No entry type is recorded, so Block 2 of the 7501 cannot be filled.",
      anchor: "#overview",
    });
  }

  performed += 1;
  const blocking = subject.openExceptions.filter((ex) =>
    BLOCKING_EXCEPTION_SEVERITIES.includes(ex.severity)
  );
  if (blocking.length > 0) {
    blockers.push({
      code: "BLOCKING_EXCEPTIONS",
      label: "No open critical or high exceptions",
      detail: `${blocking.length} open ${plural(
        blocking.length,
        "exception is",
        "exceptions are"
      )} critical or high severity.`,
      anchor: "#exceptions",
    });
  }

  performed += 1;
  const criticalIssues = subject.openReconciliationIssues.filter(
    (issue) => issue.severity === "Critical"
  );
  if (criticalIssues.length > 0) {
    blockers.push({
      code: "CRITICAL_RECONCILIATION",
      label: "No open critical reconciliation issues",
      detail: `${criticalIssues.length} critical reconciliation ${plural(
        criticalIssues.length,
        "issue is",
        "issues are"
      )} still open.`,
      anchor: "#exceptions",
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    checksPerformed: performed,
    checksPassed: performed - blockers.length,
  };
}
