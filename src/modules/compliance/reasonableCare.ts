/**
 * Reasonable care checklist evaluation.
 *
 * Pure and database-free so the scoring can be asserted without a database.
 *
 * Two rules govern everything here:
 *  - a check that cannot be performed reports "NotEvaluated"; it never reports
 *    "Pass" by default.
 *  - evidence describes what was actually inspected, never what a compliant
 *    filing would have looked like.
 */

export type ChecklistResult = "Pass" | "Fail" | "NeedsReview" | "NotEvaluated";

export interface ChecklistItem {
  item: string;
  result: ChecklistResult;
  evidence: string;
}

export type OverallResult = "Pass" | "Fail" | "NeedsReview";

export interface ReasonableCareInput {
  lineItems: Array<{ htsCode: string | null; countryOfOrigin: string | null }>;
  documents: Array<{ status: string | null }>;
  /** Declared customs value, or null when it has not been established. */
  totalValue: number | null;
  /** Audit log entries recorded against this filing. */
  auditLogCount: number;
}

export interface ReasonableCareEvaluation {
  checklistItems: ChecklistItem[];
  overallResult: OverallResult;
  /**
   * Share of performed checks that did not pass, 0-100. This is a checklist
   * outcome, not a probability of enforcement action or an absolute risk model.
   */
  riskScore: number;
  evaluatedCount: number;
}

/** HTS codes are ten digits once separators are stripped. */
function isTenDigitHts(code: string): boolean {
  return code.replace(/\D/g, "").length === 10;
}

function classificationCheck(lineItems: ReasonableCareInput["lineItems"]): ChecklistItem {
  const item = "HTS classification present and well-formed";

  if (lineItems.length === 0) {
    return { item, result: "NotEvaluated", evidence: "The filing has no line items to classify." };
  }

  const withCode = lineItems.filter((l) => l.htsCode);
  const tenDigit = withCode.filter((l) => isTenDigitHts(l.htsCode!));

  if (withCode.length < lineItems.length) {
    return {
      item,
      result: "Fail",
      evidence: `${withCode.length} of ${lineItems.length} line items have an HTS code assigned.`,
    };
  }

  if (tenDigit.length < withCode.length) {
    return {
      item,
      result: "NeedsReview",
      evidence: `All ${lineItems.length} line items are classified, but ${
        withCode.length - tenDigit.length
      } code(s) are not ten digits.`,
    };
  }

  return {
    item,
    result: "Pass",
    evidence: `All ${lineItems.length} line items carry a ten-digit HTS code.`,
  };
}

function valuationCheck(totalValue: number | null): ChecklistItem {
  const item = "Declared customs value established";

  if (totalValue === null) {
    return { item, result: "NeedsReview", evidence: "No customs value has been declared." };
  }

  if (totalValue <= 0) {
    return {
      item,
      result: "NeedsReview",
      evidence: `Declared customs value is ${totalValue.toFixed(2)}.`,
    };
  }

  // Reconciliation against the invoice is not implemented, so it is not claimed.
  return {
    item,
    result: "Pass",
    evidence: `Declared customs value is ${totalValue.toFixed(
      2
    )}. Not reconciled against invoice line totals.`,
  };
}

function originCheck(lineItems: ReasonableCareInput["lineItems"]): ChecklistItem {
  const item = "Country of origin recorded per line item";

  if (lineItems.length === 0) {
    return { item, result: "NotEvaluated", evidence: "The filing has no line items." };
  }

  const withOrigin = lineItems.filter((l) => l.countryOfOrigin);

  if (withOrigin.length === 0) {
    return { item, result: "Fail", evidence: `No line item declares a country of origin.` };
  }

  if (withOrigin.length < lineItems.length) {
    return {
      item,
      result: "NeedsReview",
      evidence: `${withOrigin.length} of ${lineItems.length} line items declare a country of origin.`,
    };
  }

  return {
    item,
    result: "Pass",
    evidence: `All ${lineItems.length} line items declare a country of origin. Marking not physically verified.`,
  };
}

function pgaCheck(documents: ReasonableCareInput["documents"]): ChecklistItem {
  // Which PGAs apply is a function of HTS chapter and product facts that this
  // system does not model, so document presence cannot stand in for the check.
  return {
    item: "Partner Government Agency documentation (FDA, EPA, TSCA)",
    result: "NotEvaluated",
    evidence: `PGA applicability is not determined by this system. ${documents.length} document(s) are attached to the shipment.`,
  };
}

function recordkeepingCheck(auditLogCount: number): ChecklistItem {
  const item = "Recordkeeping trail exists (19 U.S.C. 1508)";

  if (auditLogCount === 0) {
    return {
      item,
      result: "Fail",
      evidence: "No audit log entries are recorded against this filing.",
    };
  }

  return {
    item,
    result: "Pass",
    evidence: `${auditLogCount} audit log entr${
      auditLogCount === 1 ? "y is" : "ies are"
    } recorded against this filing. Five-year retention is not enforced by this system.`,
  };
}

export function evaluateReasonableCare(input: ReasonableCareInput): ReasonableCareEvaluation {
  const checklistItems: ChecklistItem[] = [
    classificationCheck(input.lineItems),
    valuationCheck(input.totalValue),
    originCheck(input.lineItems),
    pgaCheck(input.documents),
    recordkeepingCheck(input.auditLogCount),
  ];

  const evaluated = checklistItems.filter((c) => c.result !== "NotEvaluated");
  const failCount = evaluated.filter((c) => c.result === "Fail").length;
  const reviewCount = evaluated.filter((c) => c.result === "NeedsReview").length;

  let overallResult: OverallResult;
  if (evaluated.length === 0 || failCount > 0) {
    overallResult = failCount > 0 ? "Fail" : "NeedsReview";
  } else if (reviewCount > 0) {
    overallResult = "NeedsReview";
  } else {
    overallResult = "Pass";
  }

  const riskScore =
    evaluated.length === 0
      ? 100
      : Math.round(((failCount + reviewCount * 0.5) / evaluated.length) * 100);

  return { checklistItems, overallResult, riskScore, evaluatedCount: evaluated.length };
}
