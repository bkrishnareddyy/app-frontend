/**
 * Cross-document reconciliation rules.
 *
 * Pure and database-free so the rules can be tested directly. A rule that could
 * not run reports why it was skipped instead of contributing a clean result:
 * "no discrepancy found" and "never checked" are different answers, and only one
 * of them is evidence.
 */

export type Severity = "Info" | "Warning" | "Critical";

export interface ReconciliationDocument {
  id: string;
  docType: string;
  /** Extracted field name to value, for fields the extractor actually produced. */
  fields: Record<string, string>;
}

export interface ReconciliationLineItem {
  countryOfOrigin: string | null;
  description: string | null;
}

export interface ReconciliationInput {
  documents: ReconciliationDocument[];
  lineItems: ReconciliationLineItem[];
  incoterm: string | null;
}

export interface Detection {
  field: string;
  severity: Severity;
  expectedValue: string;
  actualValue: string;
  sourceDocuments: string[];
}

export interface ReconciliationResult {
  detections: Detection[];
  /** Rules that completed, and may therefore close their own stale issues. */
  evaluatedFields: string[];
  skippedChecks: string[];
}

interface CrossDocumentRule {
  field: string;
  fieldName: string;
  label: string;
  severity: Severity;
  compare: "number" | "text";
}

/**
 * Each rule compares one extracted field across every document that declares it.
 * Two documents must carry the field for a comparison to mean anything.
 */
const CROSS_DOCUMENT_RULES: readonly CrossDocumentRule[] = [
  { field: "quantity", fieldName: "totalQuantity", label: "Total quantity", severity: "Warning", compare: "number" },
  { field: "weight", fieldName: "grossWeight", label: "Gross weight", severity: "Warning", compare: "number" },
  { field: "totalValue", fieldName: "totalValue", label: "Declared value", severity: "Critical", compare: "number" },
  { field: "currency", fieldName: "currency", label: "Currency", severity: "Critical", compare: "text" },
  { field: "shipper", fieldName: "shipperName", label: "Shipper", severity: "Warning", compare: "text" },
  { field: "consignee", fieldName: "consigneeName", label: "Consignee", severity: "Warning", compare: "text" },
  { field: "container", fieldName: "containerNumber", label: "Container number", severity: "Critical", compare: "text" },
  { field: "billNumber", fieldName: "billOfLadingNumber", label: "Bill of lading number", severity: "Critical", compare: "text" },
  { field: "incoterm", fieldName: "incoterm", label: "Incoterm", severity: "Warning", compare: "text" },
];

/** An entry cannot be filed without these on file, so their absence blocks. */
const REQUIRED_DOCUMENT_TYPES = ["Commercial Invoice", "Packing List", "Bill of Lading"] as const;

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Returns null when the value is not a number at all. "0" is a number, so a
 * declared zero compares as zero rather than reading as a missing value.
 */
function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function declaredValue(doc: ReconciliationDocument, fieldName: string): string | null {
  const raw = doc.fields[fieldName];
  if (typeof raw !== "string") return null;
  return raw.trim() === "" ? null : raw;
}

function compareAcrossDocuments(
  rule: CrossDocumentRule,
  documents: readonly ReconciliationDocument[]
): { detection: Detection | null; evaluated: boolean; skipped: string | null } {
  const declaring = documents
    .map((doc) => {
      const value = declaredValue(doc, rule.fieldName);
      return value === null ? null : { doc, value };
    })
    .filter((entry): entry is { doc: ReconciliationDocument; value: string } => entry !== null);

  if (declaring.length < 2) {
    return {
      detection: null,
      evaluated: false,
      skipped: `${rule.field}: ${rule.label.toLowerCase()} was extracted from ${declaring.length} document${
        declaring.length === 1 ? "" : "s"
      }, so there is nothing to compare it against`,
    };
  }

  const keyed = declaring.map((entry) => {
    if (rule.compare === "number") {
      const parsed = normalizeNumber(entry.value);
      return { ...entry, key: parsed === null ? null : String(parsed) };
    }
    return { ...entry, key: normalizeText(entry.value) };
  });

  const unreadable = keyed.filter((entry) => entry.key === null);
  if (unreadable.length > 0) {
    return {
      detection: null,
      evaluated: false,
      skipped: `${rule.field}: ${rule.label.toLowerCase()} could not be read as a number on ${unreadable
        .map((entry) => entry.doc.docType)
        .join(", ")}`,
    };
  }

  const distinct = new Set(keyed.map((entry) => entry.key));
  if (distinct.size === 1) {
    return { detection: null, evaluated: true, skipped: null };
  }

  const [first, ...rest] = keyed;
  return {
    evaluated: true,
    skipped: null,
    detection: {
      field: rule.field,
      severity: rule.severity,
      expectedValue: `${first.value} (${first.doc.docType})`,
      actualValue: rest.map((entry) => `${entry.value} (${entry.doc.docType})`).join("; "),
      sourceDocuments: keyed.map((entry) => entry.doc.docType),
    },
  };
}

export function reconcileShipment(input: ReconciliationInput): ReconciliationResult {
  const detections: Detection[] = [];
  const evaluatedFields = new Set<string>();
  const skippedChecks: string[] = [];

  for (const rule of CROSS_DOCUMENT_RULES) {
    const result = compareAcrossDocuments(rule, input.documents);
    if (result.evaluated) evaluatedFields.add(rule.field);
    if (result.skipped) skippedChecks.push(result.skipped);
    if (result.detection) detections.push(result.detection);
  }

  // Document presence is always checkable, so this rule never skips. It used to
  // be filed under "container", which described a number mismatch that had not
  // been found; a missing document is a missing document.
  evaluatedFields.add("requiredDocuments");
  const missingTypes = REQUIRED_DOCUMENT_TYPES.filter(
    (required) => !input.documents.some((doc) => doc.docType.includes(required))
  );
  if (missingTypes.length > 0) {
    detections.push({
      field: "requiredDocuments",
      severity: "Critical",
      expectedValue: REQUIRED_DOCUMENT_TYPES.join(", "),
      actualValue: `Not attached: ${missingTypes.join(", ")}`,
      sourceDocuments: [...missingTypes],
    });
  }

  // The shipment record is itself a declaration, so a document that contradicts
  // it is a discrepancy even when only one document carries the field.
  const documentIncoterms = input.documents
    .map((doc) => ({ doc, value: declaredValue(doc, "incoterm") }))
    .filter((entry): entry is { doc: ReconciliationDocument; value: string } => entry.value !== null);

  if (input.incoterm && documentIncoterms.length > 0) {
    const declared = normalizeText(input.incoterm);
    const conflicting = documentIncoterms.filter((entry) => normalizeText(entry.value) !== declared);
    evaluatedFields.add("incotermOfRecord");
    if (conflicting.length > 0) {
      detections.push({
        field: "incotermOfRecord",
        severity: "Warning",
        expectedValue: `${input.incoterm} (Shipment record)`,
        actualValue: conflicting.map((entry) => `${entry.value} (${entry.doc.docType})`).join("; "),
        sourceDocuments: ["Shipment record", ...conflicting.map((entry) => entry.doc.docType)],
      });
    }
  } else if (!input.incoterm) {
    skippedChecks.push("incotermOfRecord: the shipment record declares no incoterm");
  }

  const countries = Array.from(
    new Set(input.lineItems.map((l) => l.countryOfOrigin).filter((c): c is string => !!c))
  );
  if (countries.length === 0) {
    skippedChecks.push("country: no line item declares a country of origin");
  } else {
    evaluatedFields.add("country");
    if (countries.length > 1) {
      detections.push({
        field: "country",
        severity: "Critical",
        expectedValue: "A single country of origin across all line items",
        actualValue: countries.join(", "),
        sourceDocuments: ["Shipment Line Items"],
      });
    }
  }

  const describedLines = input.lineItems.filter((l) => l.description && l.description.trim() !== "");
  if (input.lineItems.length === 0) {
    skippedChecks.push("description: the shipment has no line items");
  } else if (describedLines.length < input.lineItems.length) {
    evaluatedFields.add("description");
    detections.push({
      field: "description",
      severity: "Warning",
      expectedValue: `${input.lineItems.length} described line items`,
      actualValue: `${describedLines.length} of ${input.lineItems.length} carry a description`,
      sourceDocuments: ["Shipment Line Items"],
    });
  } else {
    evaluatedFields.add("description");
  }

  return {
    detections,
    evaluatedFields: [...evaluatedFields],
    skippedChecks,
  };
}
