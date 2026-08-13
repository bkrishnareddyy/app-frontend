/**
 * CBP Form 7501 field mapping and builder.
 *
 * Every field records its source so the UI can show "Block 29 value of $412,500
 * sourced from: ShipmentLineItem (id=...), field totalValue".
 * All duty arithmetic uses Decimal to avoid floating-point errors.
 */

import { Decimal, roundToCents } from "@/lib/tariff/decimal";

// ── Provenance ─────────────────────────────────────────────────────────────────

export interface FieldProvenance {
  value: unknown;
  sourceModel: string;
  sourceId: string | null;
  sourceField: string;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
}

/** "sourced_approved" = green; "sourced_unapproved" = amber; "missing" = red */
export type FieldStatus = "sourced_approved" | "sourced_unapproved" | "missing";

export interface Form7501FieldResult<T = unknown> {
  block: string;
  label: string;
  value: T | null;
  status: FieldStatus;
  provenance: FieldProvenance;
}

// ── Per-line-item fields ───────────────────────────────────────────────────────

export interface Form7501LineItem {
  lineNumber: number;
  description: Form7501FieldResult<string>;   // Block 28
  htsCode: Form7501FieldResult<string>;       // Block 33
  enteredValue: Form7501FieldResult<number>;  // Block 29
  dutyRate: Form7501FieldResult<number>;      // Block 34 (decimal, e.g. 0.059)
  dutyAmount: Form7501FieldResult<number>;    // Block 35 = Block29 × Block34
  countryOfOrigin: Form7501FieldResult<string>; // Block 10
  quantity: Form7501FieldResult<number>;      // Block 27
}

// ── Top-level result ───────────────────────────────────────────────────────────

export interface Form7501CoverageStatus {
  required: number;
  sourced: number;
  approved: number;
  missing: number;
}

export interface Form7501Result {
  entryType: Form7501FieldResult<string>;        // Block 1
  entryNumber: Form7501FieldResult<string>;       // Block 2
  portCode: Form7501FieldResult<string>;          // Block 45
  importerName: Form7501FieldResult<string>;      // Block 25
  importerNumber: Form7501FieldResult<string>;    // Block 23 (CBP number)
  bondNumber: Form7501FieldResult<string>;        // Block 4
  countryOfExport: Form7501FieldResult<string>;   // Block 14
  carrier: Form7501FieldResult<string>;           // Block 8
  totalEnteredValue: Form7501FieldResult<number>; // Block 40 = sum(Block29)
  totalDuty: Form7501FieldResult<number>;         // Block 43 = sum(Block35)
  lineItems: Form7501LineItem[];
  generatedAt: string;
  htsReleaseId: string | null;
  coverageStatus: Form7501CoverageStatus;
}

// ── Caller-supplied input shapes ───────────────────────────────────────────────

export interface LineItemInput {
  id: string;
  lineNumber: number;
  description: string;
  htsCode: string | null;
  quantity: number;
  unitPrice: number;
  /** Total customs value for this line (summed with Decimal below). */
  totalValue: number;
  countryOfOrigin: string | null;
  /** Approved HTS code from ClassificationDecision, if present. Overrides htsCode for Block 33. */
  approvedHtsCode?: string | null;
  approvedAt?: string | null;
  approvedByUserId?: string | null;
  classificationId?: string | null;
  /** Ad valorem duty rate as a decimal (e.g. 0.059 for 5.9%). Null when no published rate exists. */
  dutyRateDecimal?: number | null;
  htsReleaseId?: string | null;
}

export interface FilingHeaderInput {
  id: string;
  entryNumber: string | null;
  entryType: string | null;
  importerName: string | null;
  importerCbpNumber: string | null;
  importerOfRecordId: string | null;
  bondNumber: string | null;
  bondId: string | null;
  portOfEntry: string | null;
  countryOfExport: string | null;
  carrierName: string | null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function present(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

function makeProvenance(
  value: unknown,
  sourceModel: string,
  sourceId: string | null,
  sourceField: string,
  approvedByUserId?: string | null,
  approvedAt?: string | null
): FieldProvenance {
  return { value, sourceModel, sourceId, sourceField, approvedByUserId, approvedAt };
}

function deriveStatus(value: unknown, isApproved: boolean): FieldStatus {
  if (!present(value)) return "missing";
  return isApproved ? "sourced_approved" : "sourced_unapproved";
}

function headerField<T>(
  block: string,
  label: string,
  value: T | null,
  sourceModel: string,
  sourceId: string | null,
  sourceField: string,
  isApproved = true
): Form7501FieldResult<T> {
  return {
    block,
    label,
    value,
    status: deriveStatus(value, isApproved),
    provenance: makeProvenance(value, sourceModel, sourceId, sourceField),
  };
}

// ── Main builder ───────────────────────────────────────────────────────────────

/**
 * Builds a typed CBP Form 7501 data structure with full field provenance.
 *
 * Every value records which database row it was read from so the UI can display
 * "Block 29 value of $412,500 sourced from: ShipmentLineItem (...), field
 * totalValue, approved by Sarah Chen on Aug 10, 2026".
 */
export function buildForm7501(
  filing: FilingHeaderInput,
  lineItems: LineItemInput[],
  htsReleaseId: string | null
): Form7501Result {
  const lineResults: Form7501LineItem[] = lineItems.map((item) => {
    const customsValue = roundToCents(new Decimal(item.totalValue ?? 0));

    // Block 33 — prefer approved classification decision over the raw htsCode on the line
    const htsCodeValue = item.approvedHtsCode ?? item.htsCode;
    const htsIsApproved = !!item.approvedHtsCode;

    // Block 34 — ad valorem rate as a decimal (0.059 = 5.9%)
    const dutyRateDecimal = item.dutyRateDecimal ?? null;

    // Block 35 — Entered Value × Duty Rate, computed with Decimal to avoid floating-point error
    const dutyDecimal =
      dutyRateDecimal !== null
        ? roundToCents(customsValue.times(new Decimal(dutyRateDecimal)))
        : null;

    return {
      lineNumber: item.lineNumber,
      description: {
        block: "28",
        label: "Description of Merchandise",
        value: item.description ?? null,
        status: deriveStatus(item.description, true),
        provenance: makeProvenance(item.description, "ShipmentLineItem", item.id, "description"),
      },
      htsCode: {
        block: "33",
        label: "HTS Number",
        value: htsCodeValue ?? null,
        status: deriveStatus(htsCodeValue, htsIsApproved),
        provenance: makeProvenance(
          htsCodeValue,
          htsIsApproved ? "ClassificationDecision" : "ShipmentLineItem",
          htsIsApproved ? (item.classificationId ?? null) : item.id,
          htsIsApproved ? "approvedHtsNodeId" : "htsCode",
          item.approvedByUserId,
          item.approvedAt
        ),
      },
      enteredValue: {
        block: "29",
        label: "Entered Value",
        value: customsValue.toNumber(),
        status: deriveStatus(item.totalValue, true),
        provenance: makeProvenance(item.totalValue, "ShipmentLineItem", item.id, "totalValue"),
      },
      dutyRate: {
        block: "34",
        label: "Duty Rate",
        value: dutyRateDecimal,
        status: deriveStatus(dutyRateDecimal, !!htsReleaseId),
        provenance: makeProvenance(dutyRateDecimal, "HtsDutyRate", htsReleaseId, "adValoremPercent"),
      },
      dutyAmount: {
        block: "35",
        label: "Duty Amount",
        value: dutyDecimal?.toNumber() ?? null,
        status: deriveStatus(dutyDecimal?.toNumber() ?? null, dutyRateDecimal !== null),
        provenance: makeProvenance(
          dutyDecimal?.toNumber() ?? null,
          "computed",
          null,
          "Block29 × Block34"
        ),
      },
      countryOfOrigin: {
        block: "10",
        label: "Country of Origin",
        value: item.countryOfOrigin ?? null,
        status: deriveStatus(item.countryOfOrigin, true),
        provenance: makeProvenance(item.countryOfOrigin, "ShipmentLineItem", item.id, "countryOfOrigin"),
      },
      quantity: {
        block: "27",
        label: "Quantity",
        value: item.quantity,
        status: deriveStatus(item.quantity, true),
        provenance: makeProvenance(item.quantity, "ShipmentLineItem", item.id, "quantity"),
      },
    };
  });

  // Block 40 — Total Entered Value = sum of Block 29 (Decimal arithmetic to avoid float errors)
  const totalEnteredDecimal = lineResults.reduce(
    (acc, li) => acc.plus(new Decimal(li.enteredValue.value ?? 0)),
    new Decimal(0)
  );

  // Block 43 — Total Duty = sum of Block 35
  const totalDutyDecimal = lineResults.reduce(
    (acc, li) => acc.plus(new Decimal(li.dutyAmount.value ?? 0)),
    new Decimal(0)
  );

  const entryTypeField = headerField("1", "Entry Type", filing.entryType, "CustomsFiling", filing.id, "entryType");
  const entryNumberField = headerField("2", "Entry Number", filing.entryNumber, "CustomsFiling", filing.id, "entryNumber");
  const portCodeField = headerField("45", "Port of Entry", filing.portOfEntry, "Shipment", null, "portOfEntry");
  const importerNameField = headerField("25", "Importer Name", filing.importerName, "Shipment", null, "importerName");
  const importerNumberField = headerField(
    "23",
    "Importer Number (CBP)",
    filing.importerCbpNumber,
    "ImporterOfRecord",
    filing.importerOfRecordId,
    "cbpImporterNumber",
    !!filing.importerCbpNumber
  );
  const bondNumberField = headerField(
    "4",
    "Bond Number",
    filing.bondNumber,
    "Bond",
    filing.bondId,
    "bondNumber",
    !!filing.bondNumber
  );
  const countryOfExportField = headerField("14", "Country of Export", filing.countryOfExport, "Shipment", null, "countryOfExport");
  const carrierField = headerField("8", "Importing Carrier", filing.carrierName, "Shipment", null, "carrierName");

  const totalEnteredValueField: Form7501FieldResult<number> = {
    block: "40",
    label: "Total Entered Value",
    value: roundToCents(totalEnteredDecimal).toNumber(),
    status: lineResults.length > 0 ? "sourced_approved" : "missing",
    provenance: makeProvenance(
      roundToCents(totalEnteredDecimal).toNumber(),
      "computed",
      null,
      "sum(ShipmentLineItem.totalValue)"
    ),
  };

  const allDutyAmountsPresent =
    lineResults.length > 0 && lineResults.every((li) => li.dutyAmount.value !== null);
  const totalDutyField: Form7501FieldResult<number> = {
    block: "43",
    label: "Total Duty",
    value: roundToCents(totalDutyDecimal).toNumber(),
    status: allDutyAmountsPresent
      ? "sourced_approved"
      : lineResults.length > 0
      ? "sourced_unapproved"
      : "missing",
    provenance: makeProvenance(
      roundToCents(totalDutyDecimal).toNumber(),
      "computed",
      null,
      "sum(Block35)"
    ),
  };

  const allHeaderFields: Form7501FieldResult[] = [
    entryTypeField, entryNumberField, portCodeField, importerNameField,
    importerNumberField, bondNumberField, countryOfExportField, carrierField,
    totalEnteredValueField, totalDutyField,
  ];
  const allLineFields: Form7501FieldResult[] = lineResults.flatMap((li) => [
    li.description, li.htsCode, li.enteredValue, li.dutyRate, li.dutyAmount,
    li.countryOfOrigin, li.quantity,
  ]);
  const allFields = [...allHeaderFields, ...allLineFields];
  const missing = allFields.filter((f) => f.status === "missing").length;
  const approved = allFields.filter((f) => f.status === "sourced_approved").length;
  const sourced = allFields.filter((f) => f.status !== "missing").length;

  return {
    entryType: entryTypeField,
    entryNumber: entryNumberField,
    portCode: portCodeField,
    importerName: importerNameField,
    importerNumber: importerNumberField,
    bondNumber: bondNumberField,
    countryOfExport: countryOfExportField,
    carrier: carrierField,
    totalEnteredValue: totalEnteredValueField,
    totalDuty: totalDutyField,
    lineItems: lineResults,
    generatedAt: new Date().toISOString(),
    htsReleaseId,
    coverageStatus: {
      required: allFields.length,
      sourced,
      approved,
      missing,
    },
  };
}
