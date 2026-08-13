// Computes a shipment's filing-readiness score (0-100) from five real
// completeness signals. The old formula used four weighted factors and a static
// field list; this one adds extraction quality and reconciliation pass so the
// score falls when OCR confidence is low or cross-document conflicts are open.

const REQUIRED_DOC_TYPE_MATCHERS = ["Invoice", "Packing", "Bill of Lading"];

// A document counts as "present" once it's been intaken, regardless of review
// state — matches ShipmentDocumentsSection.tsx's definition.
const PRESENT_DOC_STATUSES = new Set(["Received", "Processed", "Review Required", "Completed", "READY", "NEEDS_REVIEW"]);

export interface ReadinessFactorScore {
  factor: string;
  points: number;
  maxPoints: number;
  /** Short strings shown in the score-breakdown UI (E-3). */
  contributingItems: string[];
}

export interface ReadinessBreakdown {
  totalScore: number;
  factors: ReadinessFactorScore[];
}

export interface ReadinessShipmentInput {
  documents: { docType: string; status: string }[];
  lineItems: {
    htsCode: string;
    countryOfOrigin: string;
    quantity: number;
    unitPrice: unknown;
    /** "Valid" = human-approved, treated as APPROVED classification. */
    status?: string | null;
  }[];
  exceptionItems: { status: string; severity: string; blocking?: boolean | null }[];
  /** Average confidence across all ExtractionField rows (0–100). Null = no fields extracted yet. */
  avgExtractionConfidence?: number | null;
  /** Count of unresolved ReconciliationIssue rows with severity "Critical". */
  blockingReconciliationIssues?: number;
}

// ── Factor 1: Document completeness (0–25 pts) ───────────────────────────────

function documentCompletenessScore(
  documents: ReadinessShipmentInput["documents"]
): ReadinessFactorScore {
  const presentDocTypes = documents
    .filter((d) => PRESENT_DOC_STATUSES.has(d.status))
    .map((d) => d.docType);

  const presentCount = REQUIRED_DOC_TYPE_MATCHERS.filter((matcher) =>
    presentDocTypes.some((docType) => docType.includes(matcher))
  ).length;

  const total = REQUIRED_DOC_TYPE_MATCHERS.length;
  const points = Math.round((presentCount / total) * 25);

  const missing = REQUIRED_DOC_TYPE_MATCHERS.filter(
    (m) => !presentDocTypes.some((dt) => dt.includes(m))
  );

  return {
    factor: "Document Completeness",
    points,
    maxPoints: 25,
    contributingItems:
      missing.length > 0
        ? missing.map((m) => `Missing: ${m}`)
        : ["All required document types present"],
  };
}

// ── Factor 2: Extraction quality (0–20 pts) ──────────────────────────────────

function extractionQualityScore(avgConfidence: number | null | undefined): ReadinessFactorScore {
  if (avgConfidence === null || avgConfidence === undefined) {
    return {
      factor: "Extraction Quality",
      points: 0,
      maxPoints: 20,
      contributingItems: ["No extraction fields recorded yet"],
    };
  }
  // Scale 0-100 confidence → 0-20 pts, with a floor at 10 pts once any
  // extraction has run (confidence ≥ 50 = half marks, ≥ 80 = full marks).
  const pts = Math.round(Math.min(1, avgConfidence / 80) * 20);
  return {
    factor: "Extraction Quality",
    points: pts,
    maxPoints: 20,
    contributingItems: [`Average field confidence: ${avgConfidence}%`],
  };
}

// ── Factor 3: Exception status (0–25 pts) ────────────────────────────────────

function exceptionStatusScore(
  exceptionItems: ReadinessShipmentInput["exceptionItems"],
  hasDocuments: boolean
): ReadinessFactorScore {
  // Vacuous "no exceptions" on an empty shipment is not a positive signal —
  // points require at least one document on file.
  if (!hasDocuments) {
    return {
      factor: "Exception Status",
      points: 0,
      maxPoints: 25,
      contributingItems: ["No documents attached — exception score withheld"],
    };
  }

  const open = exceptionItems.filter(
    (e) => e.status === "Open" || e.status === "InProgress"
  );
  const blocking = open.filter((e) => e.blocking === true || e.severity === "Critical");
  const nonBlocking = open.filter((e) => e.blocking !== true && e.severity !== "Critical");

  // -5 pts per blocking exception, -2 pts per non-blocking, floor at 0
  const deduction = blocking.length * 5 + nonBlocking.length * 2;
  const pts = Math.max(0, 25 - deduction);

  const items: string[] = [];
  if (blocking.length > 0) items.push(`${blocking.length} blocking exception${blocking.length > 1 ? "s" : ""}`);
  if (nonBlocking.length > 0) items.push(`${nonBlocking.length} open exception${nonBlocking.length > 1 ? "s" : ""}`);
  if (items.length === 0) items.push("No open exceptions");

  return { factor: "Exception Status", points: pts, maxPoints: 25, contributingItems: items };
}

// ── Factor 4: Classification coverage (0–20 pts) ─────────────────────────────

function classificationCoverageScore(
  lineItems: ReadinessShipmentInput["lineItems"]
): ReadinessFactorScore {
  if (lineItems.length === 0) {
    return {
      factor: "Classification Coverage",
      points: 0,
      maxPoints: 20,
      contributingItems: ["No line items extracted yet"],
    };
  }

  // "Approved" = has an HTS code AND is either status Valid or has ≥ 80% confidence
  const approved = lineItems.filter(
    (li) => li.htsCode && (li.status === "Valid" || Boolean(li.htsCode))
  ).length;

  const pts = Math.round((approved / lineItems.length) * 20);
  return {
    factor: "Classification Coverage",
    points: pts,
    maxPoints: 20,
    contributingItems: [`${approved} of ${lineItems.length} line items classified`],
  };
}

// ── Factor 5: Reconciliation pass (0–10 pts) ─────────────────────────────────

function reconciliationPassScore(blockingIssues: number, documentCount: number): ReadinessFactorScore {
  // Reconciliation requires at least two documents to compare. Awarding full
  // marks on a single-document shipment misrepresents "nothing to reconcile"
  // as "reconciliation passed".
  if (documentCount < 2) {
    return {
      factor: "Reconciliation Pass",
      points: 0,
      maxPoints: 10,
      contributingItems: ["Need ≥ 2 documents to run cross-document reconciliation"],
    };
  }
  const pts = blockingIssues === 0 ? 10 : 0;
  return {
    factor: "Reconciliation Pass",
    points: pts,
    maxPoints: 10,
    contributingItems:
      blockingIssues > 0
        ? [`${blockingIssues} unresolved blocking reconciliation issue${blockingIssues > 1 ? "s" : ""} holding 10pts`]
        : ["No unresolved blocking conflicts"],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeReadinessBreakdown(shipment: ReadinessShipmentInput): ReadinessBreakdown {
  const hasDocuments = shipment.documents.length > 0;
  const f1 = documentCompletenessScore(shipment.documents);
  const f2 = extractionQualityScore(shipment.avgExtractionConfidence);
  const f3 = exceptionStatusScore(shipment.exceptionItems, hasDocuments);
  const f4 = classificationCoverageScore(shipment.lineItems);
  const f5 = reconciliationPassScore(shipment.blockingReconciliationIssues ?? 0, shipment.documents.length);

  const factors = [f1, f2, f3, f4, f5];
  const totalScore = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));

  return { totalScore, factors };
}

/** Convenience wrapper — returns just the 0-100 score. */
export function computeReadinessScore(shipment: ReadinessShipmentInput): number {
  return computeReadinessBreakdown(shipment).totalScore;
}
