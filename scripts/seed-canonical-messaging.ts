/**
 * Seeds the canonical-messaging reference data: the versioned JSON Schemas,
 * and the FilingProcedureMapping / FilingMessageCatalog /
 * FilingResponseStatusMapping / FilingActionRule / FilingMessageActionCatalog
 * rows for US/CBP. Re-runnable: every write is an upsert.
 *
 * Run with: npx tsx scripts/seed-canonical-messaging.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { ENTRY_TYPE_CODES } from "@/modules/filing/entryType";

const db = new PrismaClient({ log: ["warn", "error"] });

const SCHEMAS_DIR = path.join(process.cwd(), "schemas", "customs-filing");

async function seedSchemas() {
  // Whichever version is listed here is the one this deployment treats as
  // ACTIVE; every other version already stored for that schemaType is demoted
  // to SUPERSEDED (never silently left ACTIVE alongside a new one). Files are
  // still versioned, reviewed, immutable artifacts under schemas/ -- a real
  // shape change is a new version file, never an in-place edit of an old one.
  const entries: Array<{ schemaType: string; dir: string; version: string }> = [
    { schemaType: "ENVELOPE_HEADER", dir: "envelope-header", version: "1.0.0" },
    // 1.0.1: entryType's description no longer names CBP specifically, and
    // compliance.uflpaCleared (a single US statute hardcoded into the
    // "canonical" contract) was replaced by a generic complianceFlags map.
    { schemaType: "FILING_REQUEST_DECLARATION", dir: "filing-request-declaration", version: "1.0.1" },
    { schemaType: "FILING_RESPONSE_DATA", dir: "filing-response-data", version: "1.0.0" },
  ];

  for (const entry of entries) {
    const filePath = path.join(SCHEMAS_DIR, entry.dir, `${entry.version}.json`);
    const schemaJson = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    await db.filingSchemaVersion.upsert({
      where: { schemaType_version: { schemaType: entry.schemaType, version: entry.version } },
      update: { schemaJson, status: "ACTIVE" },
      create: {
        schemaType: entry.schemaType,
        version: entry.version,
        schemaJson,
        status: "ACTIVE",
        effectiveFrom: new Date(),
      },
    });
    await db.filingSchemaVersion.updateMany({
      where: { schemaType: entry.schemaType, version: { not: entry.version }, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    console.log(`  Schema ${entry.schemaType}@${entry.version} -> ACTIVE`);
  }
}

async function seedMessageActions() {
  const actions = [
    { code: "SUBMIT", label: "Submission", requiresPriorMessage: false },
    { code: "AMENDMENT", label: "Amendment", requiresPriorMessage: true },
    { code: "CANCELLATION", label: "Cancellation", requiresPriorMessage: true },
    { code: "RESUBMIT", label: "Resubmission", requiresPriorMessage: true },
    { code: "STATUS_INQUIRY", label: "Status Inquiry", requiresPriorMessage: true },
  ];
  for (const a of actions) {
    await db.filingMessageActionCatalog.upsert({ where: { code: a.code }, update: a, create: a });
  }
  console.log(`  ${actions.length} FilingMessageActionCatalog rows`);
}

async function seedProcedureMapping() {
  // US/CBP: the internal entry-type code from entryType.ts IS the procedure
  // code the (stub) third party expects today. A real country integration
  // later gets its own row set without touching this one.
  for (const code of ENTRY_TYPE_CODES) {
    await db.filingProcedureMapping.upsert({
      where: { entryType_country: { entryType: code, country: "US" } },
      update: { procedureCode: code },
      create: { entryType: code, country: "US", procedureCode: code },
    });
  }
  console.log(`  ${ENTRY_TYPE_CODES.length} FilingProcedureMapping rows (US)`);
}

/**
 * Second country, proving the design: none of this required touching a
 * single line of application code, only these two seed functions. Germany's
 * declarations run through the EU's harmonized 4-digit Customs Procedure
 * Code (CPC) scheme (Commission Implementing Regulation (EU) 2015/2447)
 * rather than CBP's 2-digit entry-type codes -- exactly the kind of
 * genuinely country-specific fact FilingProcedureMapping exists to hold.
 * Deliberately a conservative subset: only entryType.ts codes with a clean,
 * confident CPC analogue are mapped, rather than guessing at all 18.
 */
async function seedGermanyConfig() {
  const procedureRows = [
    { entryType: "01", procedureCode: "4000" }, // Consumption -> release for free circulation
    { entryType: "21", procedureCode: "7100" }, // Warehouse -> customs warehousing
    { entryType: "23", procedureCode: "5300" }, // Temporary Importation under Bond -> temporary admission
  ];
  for (const row of procedureRows) {
    await db.filingProcedureMapping.upsert({
      where: { entryType_country: { entryType: row.entryType, country: "DE" } },
      update: { procedureCode: row.procedureCode },
      create: { entryType: row.entryType, country: "DE", procedureCode: row.procedureCode },
    });
  }
  console.log(`  ${procedureRows.length} FilingProcedureMapping rows (DE)`);

  await db.filingAuthorityConfig.upsert({
    where: { country: "DE" },
    update: { authorityName: "German Customs Administration (Zoll)", filingSystemLabel: "ATLAS - Automated Import System" },
    create: { country: "DE", authorityName: "German Customs Administration (Zoll)", filingSystemLabel: "ATLAS - Automated Import System" },
  });
  console.log(`  1 FilingAuthorityConfig row (DE)`);
}

async function seedMessageCatalog() {
  // These messageName/queueName values are OUR OWN internal identifiers, not
  // the third party's wire format -- "CUSTOMS_DECLARATION_SUBMIT" means the
  // same thing regardless of destination, so this is a genuinely universal
  // fact, seeded once as a wildcard row rather than duplicated per country.
  // (Previously seeded per-country as "US"; corrected here -- see changelog.)
  const rows = [
    { action: "SUBMIT", messageName: "CUSTOMS_DECLARATION_SUBMIT" },
    { action: "AMENDMENT", messageName: "CUSTOMS_DECLARATION_AMENDMENT" },
    { action: "CANCELLATION", messageName: "CUSTOMS_DECLARATION_CANCELLATION" },
    { action: "RESUBMIT", messageName: "CUSTOMS_DECLARATION_RESUBMIT" },
    { action: "STATUS_INQUIRY", messageName: "CUSTOMS_DECLARATION_STATUS_INQUIRY" },
  ];
  for (const row of rows) {
    await db.filingMessageCatalog.upsert({
      where: {
        action_country_procedureCode: { action: row.action, country: "*", procedureCode: "*" },
      },
      update: { messageName: row.messageName, queueName: "customs-filing-outbound" },
      create: {
        action: row.action,
        country: "*",
        procedureCode: "*",
        messageName: row.messageName,
        queueName: "customs-filing-outbound",
      },
    });
  }
  // Clean up the old US-specific rows this table used to have -- fully
  // superseded by the wildcard rows above (identical messageName/queueName),
  // not left behind as redundant, silently-shadowing duplicates.
  const staleCount = await db.filingMessageCatalog.count({ where: { country: "US" } });
  if (staleCount > 0) {
    await db.filingMessageCatalog.deleteMany({ where: { country: "US" } });
  }
  console.log(`  ${rows.length} FilingMessageCatalog rows (*)${staleCount > 0 ? ` (removed ${staleCount} stale US-specific rows)` : ""}`);
}

async function seedResponseStatusMapping() {
  // Deliberately still no ERROR row: an error responding to a SUBMIT and an
  // error responding to a CANCELLATION don't mean the same thing for
  // filingStatus, and there's no single correct transition to guess at.
  // CANCELLED now has one (`cbp.cancel`, filingStateMachine.ts) -- a
  // confirmed cancellation of an already-transmitted entry is unambiguous:
  // the filing is Cancelled. The inbound consumer still records the response
  // and leaves filingStatus unchanged for any status this table has no row
  // for, rather than guessing. See changelog.
  //
  // Wildcard country, not "US": "an ACCEPTED response accepts the filing"
  // isn't a US-specific rule -- every destination's response maps onto the
  // same filingStateMachine.ts transitions the same way. The `cbp.` prefix on
  // the transition identifiers is a naming leftover, not a behavioral
  // restriction; a country whose authority genuinely needs a different
  // mapping gets its own country-specific row, which still wins over this
  // one via most-specific-match. (Previously seeded per-country as "US";
  // corrected here -- see changelog.)
  const rows = [
    { canonicalStatus: "ACCEPTED", filingTransition: "cbp.accept" },
    { canonicalStatus: "REJECTED", filingTransition: "cbp.reject" },
    { canonicalStatus: "NEEDS_INFO", filingTransition: "cbp.requestDocuments" },
    { canonicalStatus: "RELEASED", filingTransition: "cbp.release" },
    { canonicalStatus: "CANCELLED", filingTransition: "cbp.cancel" },
  ];
  for (const row of rows) {
    await db.filingResponseStatusMapping.upsert({
      where: {
        country_messageName_canonicalStatus: {
          country: "*",
          messageName: "*",
          canonicalStatus: row.canonicalStatus,
        },
      },
      update: { filingTransition: row.filingTransition },
      create: { country: "*", messageName: "*", canonicalStatus: row.canonicalStatus, filingTransition: row.filingTransition },
    });
  }
  const staleCount = await db.filingResponseStatusMapping.count({ where: { country: "US" } });
  if (staleCount > 0) {
    await db.filingResponseStatusMapping.deleteMany({ where: { country: "US" } });
  }
  console.log(`  ${rows.length} FilingResponseStatusMapping rows (*)${staleCount > 0 ? ` (removed ${staleCount} stale US-specific rows)` : ""}`);
}

async function seedFilingActionRules() {
  // The states a declaration can be corrected from. "Draft" is intentionally
  // excluded -- pre-transmission editing already happens through the normal
  // shipment-editing UI, not this declaration edit/resubmit flow.
  const editableStatuses = ["ValidationFailed", "Rejected", "DocumentsRequested"];
  for (const status of editableStatuses) {
    await db.filingActionRule.upsert({
      where: {
        country_procedureCode_messageName_status: { country: "*", procedureCode: "*", messageName: "*", status },
      },
      update: { allowUpdates: true },
      create: { country: "*", procedureCode: "*", messageName: "*", status, allowUpdates: true },
    });
  }
  console.log(`  ${editableStatuses.length} FilingActionRule rows`);
}

async function seedFilingAuthorityConfig() {
  // No wildcard row here on purpose (see the model comment) -- adding a
  // country is adding a row, not widening a fallback that would silently
  // apply the wrong authority name to a country nobody has configured yet.
  const rows = [{ country: "US", authorityName: "U.S. Customs and Border Protection (CBP)", filingSystemLabel: "ABI - Automated" }];
  for (const row of rows) {
    await db.filingAuthorityConfig.upsert({
      where: { country: row.country },
      update: { authorityName: row.authorityName, filingSystemLabel: row.filingSystemLabel },
      create: row,
    });
  }
  console.log(`  ${rows.length} FilingAuthorityConfig rows`);
}

async function seedFilingChildActionRules() {
  // Which statuses offer CANCEL, as a dynamic action list rather than a
  // boolean column -- matches filingStateMachine.ts's `cancel.request`
  // from-list exactly. Adding AMEND or INVALIDATE later is new rows here,
  // never a new column or a new UI prop. Pre-transmission statuses are
  // excluded: those withdraw via the (separate, UI-less today) `cancel`
  // transition, not this message-based one.
  const rows: Array<{ status: string; action: string }> = [
    { status: "TransmissionPending", action: "CANCEL" },
    { status: "Transmitted", action: "CANCEL" },
    { status: "Accepted", action: "CANCEL" },
    { status: "Rejected", action: "CANCEL" },
    { status: "DocumentsRequested", action: "CANCEL" },
    { status: "CustomsHold", action: "CANCEL" },
  ];
  for (const row of rows) {
    await db.filingChildActionRule.upsert({
      where: {
        country_procedureCode_messageName_status_action: {
          country: "*",
          procedureCode: "*",
          messageName: "*",
          status: row.status,
          action: row.action,
        },
      },
      update: {},
      create: { country: "*", procedureCode: "*", messageName: "*", status: row.status, action: row.action },
    });
  }
  console.log(`  ${rows.length} FilingChildActionRule rows`);
}

async function main() {
  console.log("Seeding canonical-messaging reference data...");
  await seedSchemas();
  await seedMessageActions();
  await seedProcedureMapping();
  await seedMessageCatalog();
  await seedResponseStatusMapping();
  await seedFilingActionRules();
  await seedFilingChildActionRules();
  await seedFilingAuthorityConfig();
  await seedGermanyConfig();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
