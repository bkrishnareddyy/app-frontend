/**
 * Seeds NL Import filing configuration.
 * 
 * Tables seeded:
 * - FilingTransactionType (IMPORT transaction type - already exists)
 * - FilingActionCatalog (universal actions - already exists)
 * - FilingProcedureConfig (NL Import procedures and messages)
 * - FilingActionMessageMapping (NL Import action → message mapping)
 * - FilingActionConfiguration (NL Import action availability rules)
 * 
 * Re-runnable: every write is an upsert.
 * Run with: npx tsx scripts/seed-nl-import-filing.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: ["warn", "error"] });

/**
 * Ensure universal transaction types exist
 * (This is idempotent - safe to run even if already seeded)
 */
async function ensureTransactionTypes() {
  const transactionTypes = [
    { code: "IMPORT" },
    { code: "EXPORT" },
  ];

  for (const type of transactionTypes) {
    await db.filingTransactionType.upsert({
      where: { code: type.code },
      update: { isActive: true, updatedAt: new Date(), updatedBy: "system" },
      create: {
        code: type.code,
        isActive: true,
        createdBy: "system",
        updatedBy: "system",
      },
    });
  }

  console.log(`  ✓ ${transactionTypes.length} FilingTransactionType rows ensured`);
}

/**
 * Ensure universal actions exist
 * (This is idempotent - safe to run even if already seeded)
 */
async function ensureActionCatalog() {
  const actions = [
    { code: "SUBMIT" },
    { code: "AMENDMENT" },
    { code: "CANCELLATION" },
    { code: "QUERY_RESPONSE" },
    { code: "ADDITIONAL_INFO" },
    { code: "RESUBMIT" },
  ];

  for (const action of actions) {
    await db.filingActionCatalog.upsert({
      where: { code: action.code },
      update: { isActive: true, updatedAt: new Date(), updatedBy: "system" },
      create: {
        code: action.code,
        isActive: true,
        createdBy: "system",
        updatedBy: "system",
      },
    });
  }

  console.log(`  ✓ ${actions.length} FilingActionCatalog rows ensured`);
}

/**
 * Seed NL Import procedure configuration
 * Lists valid messages for Netherlands Import procedures
 */
async function seedNlImportProcedures() {
  // Get IMPORT transaction type ID
  const importType = await db.filingTransactionType.findUnique({
    where: { code: "IMPORT" },
  });

  if (!importType) {
    throw new Error("IMPORT transaction type not found. Run ensureTransactionTypes first.");
  }

  const procedures = [
    // Standard Import Declaration - H1 Procedure
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501", // Import Declaration
    },
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H1",
      messageName: "IE503", // Amendment
    },
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H1",
      messageName: "IE504", // Cancellation
    },
    // Simplified Import Declaration - H4 Procedure
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H4",
      messageName: "IE501", // Simplified Import Declaration
    },
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H4",
      messageName: "IE503", // Amendment
    },
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H4",
      messageName: "IE504", // Cancellation
    },
    // Pre-Arrival Declaration - H7 Procedure
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H7",
      messageName: "IE501", // Pre-Arrival Declaration
    },
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H7",
      messageName: "IE503", // Amendment
    },
    {
      transactionTypeId: importType.id,
      country: "NL",
      procedureCode: "H7",
      messageName: "IE504", // Cancellation
    },
  ];

  for (const proc of procedures) {
    await db.filingProcedureConfig.upsert({
      where: {
        country_procedureCode_messageName: {
          country: proc.country,
          procedureCode: proc.procedureCode,
          messageName: proc.messageName,
        },
      },
      update: {
        transactionTypeId: proc.transactionTypeId,
        isActive: true,
        updatedAt: new Date(),
        updatedBy: "system",
      },
      create: {
        transactionTypeId: proc.transactionTypeId,
        country: proc.country,
        procedureCode: proc.procedureCode,
        messageName: proc.messageName,
        isActive: true,
        createdBy: "system",
        updatedBy: "system",
      },
    });
  }

  console.log(`  ✓ ${procedures.length} FilingProcedureConfig rows seeded (NL Import)`);
}

/**
 * Seed NL Import action to message mapping
 * Maps user actions to outbound message names
 */
async function seedNlImportActionMessageMapping() {
  const mappings = [
    // H1 - Standard Import
    {
      country: "NL",
      procedureCode: "H1",
      action: "SUBMIT",
      messageName: "IE501", // Submit sends IE501 Declaration
    },
    {
      country: "NL",
      procedureCode: "H1",
      action: "AMENDMENT",
      messageName: "IE503", // Amendment sends IE503
    },
    {
      country: "NL",
      procedureCode: "H1",
      action: "CANCELLATION",
      messageName: "IE504", // Cancellation sends IE504
    },
    // H4 - Simplified Import
    {
      country: "NL",
      procedureCode: "H4",
      action: "SUBMIT",
      messageName: "IE501",
    },
    {
      country: "NL",
      procedureCode: "H4",
      action: "AMENDMENT",
      messageName: "IE503",
    },
    {
      country: "NL",
      procedureCode: "H4",
      action: "CANCELLATION",
      messageName: "IE504",
    },
    // H7 - Pre-Arrival Declaration
    {
      country: "NL",
      procedureCode: "H7",
      action: "SUBMIT",
      messageName: "IE501",
    },
    {
      country: "NL",
      procedureCode: "H7",
      action: "AMENDMENT",
      messageName: "IE503",
    },
    {
      country: "NL",
      procedureCode: "H7",
      action: "CANCELLATION",
      messageName: "IE504",
    },
  ];

  for (const mapping of mappings) {
    await db.filingActionMessageMapping.upsert({
      where: {
        country_procedureCode_action: {
          country: mapping.country,
          procedureCode: mapping.procedureCode,
          action: mapping.action,
        },
      },
      update: {
        messageName: mapping.messageName,
        isActive: true,
        updatedAt: new Date(),
        updatedBy: "system",
      },
      create: {
        country: mapping.country,
        procedureCode: mapping.procedureCode,
        action: mapping.action,
        messageName: mapping.messageName,
        isActive: true,
        createdBy: "system",
        updatedBy: "system",
      },
    });
  }

  console.log(`  ✓ ${mappings.length} FilingActionMessageMapping rows seeded (NL Import)`);
}

/**
 * Seed NL Import action availability rules
 * Determines which actions are available based on request message sent and response status received
 */
async function seedNlImportActionConfiguration() {
  const configurations = [
    // ========================================
    // H1 - Standard Import Declaration Lifecycle
    // ========================================
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501", // Import Declaration
      status: "DRAFT",
      availableActions: ["SUBMIT"],
      allowSubmit: true,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501",
      status: "TRANSMITTED", // Before response received
      availableActions: ["CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501",
      status: "ACCEPTED", // Positive response (IE502)
      availableActions: ["AMENDMENT", "CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501",
      status: "REJECTED", // Negative response
      availableActions: ["CANCELLATION"],
      allowSubmit: true, // Can resubmit after fixing errors
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501",
      status: "PENDING_PAYMENT", // Awaiting duty payment
      availableActions: ["AMENDMENT", "CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE501",
      status: "RELEASED", // Goods released
      availableActions: [], // No actions available after release
      allowSubmit: false,
    },

    // ========================================
    // H1 - Amendment Lifecycle (IE503)
    // ========================================
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE503", // Amendment sent
      status: "TRANSMITTED", // Before response
      availableActions: [], // Wait for response
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE503",
      status: "ACCEPTED", // Amendment accepted
      availableActions: ["AMENDMENT", "CANCELLATION"], // Can amend again or cancel
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE503",
      status: "REJECTED", // Amendment rejected
      availableActions: ["AMENDMENT"], // Can try to amend again
      allowSubmit: false,
    },

    // ========================================
    // H1 - Cancellation Lifecycle (IE504)
    // ========================================
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE504", // Cancellation sent
      status: "TRANSMITTED", // Before response
      availableActions: [], // Wait for response
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE504",
      status: "ACCEPTED", // Cancellation accepted
      availableActions: [], // Declaration cancelled, no further actions
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H1",
      messageName: "IE504",
      status: "REJECTED", // Cancellation rejected
      availableActions: ["CANCELLATION"], // Can retry cancellation
      allowSubmit: false,
    },

    // ========================================
    // H4 - Simplified Import Declaration (same lifecycle as H1)
    // ========================================
    {
      country: "NL",
      procedureCode: "H4",
      messageName: "IE501",
      status: "DRAFT",
      availableActions: ["SUBMIT"],
      allowSubmit: true,
    },
    {
      country: "NL",
      procedureCode: "H4",
      messageName: "IE501",
      status: "TRANSMITTED",
      availableActions: ["CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H4",
      messageName: "IE501",
      status: "ACCEPTED",
      availableActions: ["AMENDMENT", "CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H4",
      messageName: "IE501",
      status: "REJECTED",
      availableActions: ["CANCELLATION"],
      allowSubmit: true,
    },
    {
      country: "NL",
      procedureCode: "H4",
      messageName: "IE501",
      status: "RELEASED",
      availableActions: [],
      allowSubmit: false,
    },

    // ========================================
    // H7 - Pre-Arrival Declaration (same lifecycle as H1)
    // ========================================
    {
      country: "NL",
      procedureCode: "H7",
      messageName: "IE501",
      status: "DRAFT",
      availableActions: ["SUBMIT"],
      allowSubmit: true,
    },
    {
      country: "NL",
      procedureCode: "H7",
      messageName: "IE501",
      status: "TRANSMITTED",
      availableActions: ["CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H7",
      messageName: "IE501",
      status: "ACCEPTED",
      availableActions: ["AMENDMENT", "CANCELLATION"],
      allowSubmit: false,
    },
    {
      country: "NL",
      procedureCode: "H7",
      messageName: "IE501",
      status: "REJECTED",
      availableActions: ["CANCELLATION"],
      allowSubmit: true,
    },
    {
      country: "NL",
      procedureCode: "H7",
      messageName: "IE501",
      status: "RELEASED",
      availableActions: [],
      allowSubmit: false,
    },
  ];

  for (const config of configurations) {
    await db.filingActionConfiguration.upsert({
      where: {
        country_procedureCode_messageName_status: {
          country: config.country,
          procedureCode: config.procedureCode,
          messageName: config.messageName,
          status: config.status,
        },
      },
      update: {
        availableActions: config.availableActions,
        allowSubmit: config.allowSubmit,
        isActive: true,
        updatedAt: new Date(),
        updatedBy: "system",
      },
      create: {
        country: config.country,
        procedureCode: config.procedureCode,
        messageName: config.messageName,
        status: config.status,
        availableActions: config.availableActions,
        allowSubmit: config.allowSubmit,
        isActive: true,
        createdBy: "system",
        updatedBy: "system",
      },
    });
  }

  console.log(`  ✓ ${configurations.length} FilingActionConfiguration rows seeded (NL Import)`);
}

async function main() {
  console.log("\n🌍 Seeding NL Import Filing Configuration...\n");

  try {
    await ensureTransactionTypes();
    await ensureActionCatalog();
    await seedNlImportProcedures();
    await seedNlImportActionMessageMapping();
    await seedNlImportActionConfiguration();

    console.log("\n✅ NL Import filing configuration seeded successfully!");
    console.log("\nSeeded:");
    console.log("  - 9 NL Import procedure configurations (H1, H4, H7)");
    console.log("  - 9 NL Import action mappings");
    console.log("  - 27 NL Import action configuration rules");
    console.log("\nProcedure Codes:");
    console.log("  - H1: Standard Import Declaration");
    console.log("  - H4: Simplified Import Declaration");
    console.log("  - H7: Pre-Arrival Declaration");
    console.log("\nMessages:");
    console.log("  - IE501: Import Declaration");
    console.log("  - IE502: Import Declaration Response (received)");
    console.log("  - IE503: Amendment Request");
    console.log("  - IE504: Cancellation Request\n");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
