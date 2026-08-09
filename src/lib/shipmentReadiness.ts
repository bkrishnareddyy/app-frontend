// Computes a shipment's filing-readiness score (0-100) from real completeness
// signals, rather than the Shipment.readinessScore column, which is a static
// default (87, or 85 on a few creation paths) that was never actually updated
// as documents/line items/exceptions changed.

// Matched by substring against ShipmentDocument.docType, consistent with how
// the rest of the app identifies document types (e.g. reconcile/route.ts):
// actual docType values are full catalog names like "Packing List / Weight
// List" and "Ocean Bill of Lading (B/L)", not these short forms.
const REQUIRED_DOC_TYPE_MATCHERS = ["Invoice", "Packing", "Bill of Lading"];

// A document counts as "present" once it's been intaken, regardless of
// review state -- matches ShipmentDocumentsSection.tsx's definition. Status
// "Received" alone is far too narrow: across real data almost no document
// ever literally reaches that exact status.
const PRESENT_DOC_STATUSES = new Set(["Received", "Processed", "Review Required", "Completed"]);

const REQUIRED_SHIPMENT_FIELDS = [
  "importerName",
  "poReference",
  "entryType",
  "incoterm",
  "portOfEntry",
  "countryOfExport",
] as const;

const EXCEPTION_SEVERITY_WEIGHT: Record<string, number> = {
  Critical: 1,
  High: 0.75,
  Medium: 0.4,
  Low: 0.15,
};

export interface ReadinessShipmentInput {
  importerName?: string | null;
  poReference?: string | null;
  entryType?: string | null;
  incoterm?: string | null;
  portOfEntry?: string | null;
  countryOfExport?: string | null;
  documents: { docType: string; status: string }[];
  lineItems: { htsCode: string; countryOfOrigin: string; quantity: number; unitPrice: unknown }[];
  exceptionItems: { status: string; severity: string }[];
}

export function computeReadinessScore(shipment: ReadinessShipmentInput): number {
  // Shipment-level field completeness
  const fieldsPresent = REQUIRED_SHIPMENT_FIELDS.filter((field) => Boolean(shipment[field])).length;
  const fieldScore = fieldsPresent / REQUIRED_SHIPMENT_FIELDS.length;

  // Required document intake
  const presentDocTypes = shipment.documents
    .filter((d) => PRESENT_DOC_STATUSES.has(d.status))
    .map((d) => d.docType);
  const docsPresent = REQUIRED_DOC_TYPE_MATCHERS.filter((matcher) =>
    presentDocTypes.some((docType) => docType.includes(matcher))
  ).length;
  const docScore = docsPresent / REQUIRED_DOC_TYPE_MATCHERS.length;

  // Line item completeness: HTS code, country of origin, and valid quantity/price
  const lineItemScore =
    shipment.lineItems.length === 0
      ? 0
      : shipment.lineItems.filter(
          (li) => li.htsCode && li.countryOfOrigin && li.quantity > 0 && Number(li.unitPrice) > 0
        ).length / shipment.lineItems.length;

  // Open exceptions penalize the score, weighted by severity
  const openExceptions = shipment.exceptionItems.filter(
    (e) => e.status === "Open" || e.status === "InProgress"
  );
  const exceptionPenalty = openExceptions.reduce(
    (sum, e) => sum + (EXCEPTION_SEVERITY_WEIGHT[e.severity] ?? EXCEPTION_SEVERITY_WEIGHT.Medium),
    0
  );
  // 4+ weighted points of open exceptions fully zeroes this component
  const exceptionScore = Math.max(0, 1 - exceptionPenalty / 4);

  const weighted = fieldScore * 20 + docScore * 30 + lineItemScore * 30 + exceptionScore * 20;

  return Math.round(Math.max(0, Math.min(100, weighted)));
}
