/**
 * Seeds complex FilingActionDataRequirement rows for CANCELLATION and
 * AMENDMENT so the "Required Fields" resolution engine
 * (src/lib/canonicalMessaging/actionDataRequirements.ts) has real,
 * multi-level data to resolve against: scalar prompt fields, a
 * shipment-sourced field, and a two-level-deep nested grid
 * (GoodsItem rows, each containing its own Packages/ChangeSet grid).
 *
 * Run with: npx tsx scripts/seed-action-data-requirements.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CANCELLATION_FIELDS = [
  {
    key: "cancellationReason",
    label: "Cancellation Reason",
    type: "text",
    required: true,
    source: "prompt",
    helpText: "Why this declaration is being cancelled -- required by CBP on every cancellation request.",
  },
  {
    key: "cancellationReasonCode",
    label: "Cancellation Reason Code",
    type: "text",
    required: true,
    source: "prompt",
    helpText: 'CBP reason code, e.g. "1" (Filed in Error), "2" (Duplicate Filing), "3" (Cargo Not Imported).',
  },
  {
    key: "guaranteeReference",
    label: "Guarantee Reference",
    type: "text",
    required: false,
    source: "prompt",
    helpText: "Bond/guarantee reference tied to the original entry, if a new one was posted since filing.",
  },
  {
    key: "requestedByBroker",
    label: "Requested By Broker",
    type: "boolean",
    required: true,
    source: "prompt",
    helpText: "Whether the customs broker (rather than the importer directly) is requesting this cancellation.",
  },
  {
    key: "originalEntryNumber",
    label: "Original Entry Number",
    type: "text",
    required: true,
    source: "shipment.filing.entryNumber",
    helpText: "Resolved automatically from the filing being cancelled -- never asked of the operator.",
  },
  {
    key: "affectedGoodsItems",
    label: "Affected Goods Items",
    type: "grid",
    required: true,
    source: "prompt",
    helpText: "Every line item on the declaration affected by this cancellation, and why.",
    columns: [
      { key: "lineNumber", label: "Line Number", type: "number", required: true, source: "prompt" },
      { key: "hsCode6", label: "HS Code", type: "text", required: true, source: "prompt" },
      { key: "reasonForRemoval", label: "Reason For Removal", type: "text", required: true, source: "prompt" },
      {
        key: "affectedPackages",
        label: "Affected Packages",
        type: "grid",
        required: false,
        source: "prompt",
        helpText: "Optional: specific packages within this line item affected by the cancellation.",
        columns: [
          { key: "packageId", label: "Package ID", type: "text", required: true, source: "prompt" },
          { key: "weightKg", label: "Weight (kg)", type: "number", required: true, source: "prompt" },
          { key: "quarantineHold", label: "Quarantine Hold", type: "boolean", required: false, source: "prompt" },
        ],
      },
    ],
  },
];

const AMENDMENT_FIELDS = [
  {
    key: "amendmentReason",
    label: "Amendment Reason",
    type: "text",
    required: true,
    source: "prompt",
    helpText: "Plain-language reason this declaration is being amended.",
  },
  {
    key: "amendmentTypeCode",
    label: "Amendment Type Code",
    type: "text",
    required: true,
    source: "prompt",
    helpText: 'e.g. "PSC" (Post-Summary Correction), "VALUE_ADJ" (Value Adjustment), "HTS_CORRECTION".',
  },
  {
    key: "brokerApprovalReference",
    label: "Broker Approval Reference",
    type: "text",
    required: false,
    source: "prompt",
  },
  {
    key: "supersedesEntryNumber",
    label: "Supersedes Entry Number",
    type: "text",
    required: true,
    source: "shipment.filing.entryNumber",
    helpText: "Resolved automatically from the filing being amended.",
  },
  {
    key: "requiresReliquidation",
    label: "Requires Reliquidation",
    type: "boolean",
    required: true,
    source: "prompt",
    helpText: "Whether this amendment changes duty/tax owed and must trigger reliquidation.",
  },
  {
    key: "amendedLineItems",
    label: "Amended Line Items",
    type: "grid",
    required: true,
    source: "prompt",
    helpText: "Every line item being changed, and the field-level before/after values for each.",
    columns: [
      { key: "lineNumber", label: "Line Number", type: "number", required: true, source: "prompt" },
      {
        key: "fieldChanges",
        label: "Field Changes",
        type: "grid",
        required: true,
        source: "prompt",
        helpText: "Each individual field being corrected on this line item.",
        columns: [
          { key: "fieldName", label: "Field Name", type: "text", required: true, source: "prompt" },
          { key: "oldValue", label: "Old Value", type: "text", required: true, source: "prompt" },
          { key: "newValue", label: "New Value", type: "text", required: true, source: "prompt" },
          { key: "changeDate", label: "Change Date", type: "date", required: false, source: "prompt" },
        ],
      },
    ],
  },
];

async function upsert(action: string, fields: unknown) {
  await db.filingActionDataRequirement.upsert({
    where: {
      country_procedureCode_messageName_action: {
        country: "US",
        procedureCode: "*",
        messageName: "*",
        action,
      },
    },
    update: { fields: fields as any },
    create: {
      country: "US",
      procedureCode: "*",
      messageName: "*",
      action,
      fields: fields as any,
    },
  });
  console.log(`Seeded FilingActionDataRequirement for action=${action}`);
}

async function main() {
  await upsert("CANCELLATION", CANCELLATION_FIELDS);
  await upsert("AMENDMENT", AMENDMENT_FIELDS);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
