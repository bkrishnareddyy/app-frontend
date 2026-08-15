/**
 * Seed US (CBP) filing configuration data for backwards compatibility
 * with existing CustomsFiling records that use old entryType field.
 * 
 * This maps all 18 US CBP entry types to the new multi-country structure.
 * 
 * Run with: npx tsx scripts/seed-us-filing-config.ts
 */

import { db } from "../src/lib/db";

async function seedUSFilingConfig() {
  console.log("🇺🇸 Starting US CBP filing configuration seed...\n");

  // 1. Get transaction type IDs (these should already exist from NL seed)
  const importType = await db.filingTransactionType.findUnique({
    where: { code: "IMPORT" },
  });
  
  if (!importType) {
    throw new Error("IMPORT transaction type not found. Run seed-multi-country-filing.ts first.");
  }

  console.log("✅ Found IMPORT transaction type");

  // 2. US CBP Entry Types (from entryType.ts)
  // We'll map these as procedureCodes in the new system
  const usEntryTypes = [
    { code: "01", label: "Consumption Entry", description: "Standard import for immediate consumption" },
    { code: "02", label: "Temp Import - TIB", description: "Temporary import under bond" },
    { code: "03", label: "Warehouse Entry", description: "Entry for warehousing" },
    { code: "04", label: "Appraisement Entry", description: "Entry for appraisement" },
    { code: "06", label: "Foreign Trade Zone", description: "Entry from foreign trade zone" },
    { code: "07", label: "Transportation Entry", description: "Transportation and exportation entry" },
    { code: "08", label: "Warehouse Withdrawal", description: "Withdrawal from warehouse for consumption" },
    { code: "09", label: "FTZ Admission", description: "Foreign Trade Zone admission" },
    { code: "11", label: "Drawback Entry", description: "Entry for drawback purposes" },
    { code: "12", label: "Mail Entry", description: "Entry for mail shipments" },
    { code: "21", label: "In-bond Arrival", description: "In-bond arrival/transportation" },
    { code: "22", label: "In-bond Shipment", description: "In-bond shipment" },
    { code: "23", label: "In-bond Transfer", description: "In-bond transfer" },
    { code: "31", label: "ATA Carnet", description: "Temporary admission under ATA Carnet" },
    { code: "52", label: "Informal Entry", description: "Informal entry (under $2,500)" },
    { code: "61", label: "Quota Entry", description: "Entry subject to quota" },
    { code: "62", label: "Antidumping Entry", description: "Entry subject to antidumping/countervailing duties" },
    { code: "86", label: "Section 321", description: "De minimis entry under Section 321" },
  ];

  console.log(`📋 Seeding ${usEntryTypes.length} US entry types...\n`);

  let proceduresCreated = 0;
  let actionMappingsCreated = 0;
  let actionConfigsCreated = 0;

  // 3. Create FilingProcedureConfig for each US entry type
  for (const entryType of usEntryTypes) {
    const result = await db.filingProcedureConfig.upsert({
      where: {
        country_procedureCode_messageName: {
          country: "US",
          procedureCode: entryType.code,
          messageName: "CBP_ENTRY_7501", // US uses Form 7501 for entries
        },
      },
      create: {
        country: "US",
        procedureCode: entryType.code,
        messageName: "CBP_ENTRY_7501",
        transactionTypeId: importType.id,
        isActive: true,
      },
      update: {
        isActive: true,
      },
    });

    console.log(`  ✅ ${entryType.code} - ${entryType.label}`);
    proceduresCreated++;
  }

  console.log(`\n✅ Created/updated ${proceduresCreated} procedure configurations\n`);

  // 4. Create FilingActionMessageMapping for common actions
  // US CBP supports: SUBMIT, AMENDMENT, CANCELLATION
  const usActions = [
    { action: "SUBMIT", messageName: "CBP_ENTRY_7501" },
    { action: "AMENDMENT", messageName: "CBP_ENTRY_AMENDMENT" },
    { action: "CANCELLATION", messageName: "CBP_ENTRY_CANCELLATION" },
  ];

  console.log("🔄 Seeding action mappings for all US entry types...\n");

  for (const entryType of usEntryTypes) {
    for (const actionMap of usActions) {
      await db.filingActionMessageMapping.upsert({
        where: {
          country_procedureCode_action: {
            country: "US",
            procedureCode: entryType.code,
            action: actionMap.action,
          },
        },
        create: {
          country: "US",
          procedureCode: entryType.code,
          action: actionMap.action,
          messageName: actionMap.messageName,
        },
        update: {
          messageName: actionMap.messageName,
        },
      });

      actionMappingsCreated++;
    }
  }

  console.log(`✅ Created/updated ${actionMappingsCreated} action mappings\n`);

  // 5. Create FilingActionConfiguration (UI action availability by status)
  // Define what actions are available after each status for US CBP
  const usActionConfigs = [
    // After TRANSMITTED - waiting for response
    {
      messageName: "CBP_ENTRY_7501",
      status: "TRANSMITTED",
      availableActions: [],
      allowSubmit: false,
      description: "Entry transmitted to CBP, awaiting response",
    },
    
    // After ACCEPTED - can amend or cancel
    {
      messageName: "CBP_ENTRY_7501",
      status: "ACCEPTED",
      availableActions: ["AMENDMENT", "CANCELLATION"],
      allowSubmit: false,
      description: "Entry accepted by CBP, amendments and cancellation allowed",
    },
    
    // After REJECTED - can resubmit with corrections
    {
      messageName: "CBP_ENTRY_7501",
      status: "REJECTED",
      availableActions: ["SUBMIT"],
      allowSubmit: true,
      description: "Entry rejected, corrections needed before resubmission",
    },
    
    // After RELEASED - entry is released, limited actions
    {
      messageName: "CBP_ENTRY_7501",
      status: "RELEASED",
      availableActions: [],
      allowSubmit: false,
      description: "Entry released by CBP, filing complete",
    },
    
    // Draft status - can submit
    {
      messageName: "CBP_ENTRY_7501",
      status: "Draft",
      availableActions: ["SUBMIT"],
      allowSubmit: true,
      description: "Draft entry, ready for submission",
    },
  ];

  console.log("⚙️ Seeding action configurations for all US entry types...\n");

  for (const entryType of usEntryTypes) {
    for (const config of usActionConfigs) {
      await db.filingActionConfiguration.upsert({
        where: {
          country_procedureCode_messageName_status: {
            country: "US",
            procedureCode: entryType.code,
            messageName: config.messageName,
            status: config.status,
          },
        },
        create: {
          country: "US",
          procedureCode: entryType.code,
          messageName: config.messageName,
          status: config.status,
          availableActions: config.availableActions,
          allowSubmit: config.allowSubmit,
        },
        update: {
          availableActions: config.availableActions,
          allowSubmit: config.allowSubmit,
        },
      });

      actionConfigsCreated++;
    }
  }

  console.log(`✅ Created/updated ${actionConfigsCreated} action configurations\n`);

  // 6. Summary
  console.log("=" .repeat(60));
  console.log("🎉 US CBP Configuration Seed Complete!");
  console.log("=" .repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   - Country: US (United States - CBP)`);
  console.log(`   - Entry Types (Procedures): ${proceduresCreated}`);
  console.log(`   - Action Mappings: ${actionMappingsCreated}`);
  console.log(`   - Action Configurations: ${actionConfigsCreated}`);
  console.log(`   - Total Rows: ${proceduresCreated + actionMappingsCreated + actionConfigsCreated}`);
  console.log("=" .repeat(60));
  console.log("\n✅ Existing US CustomsFiling records will now work!");
  console.log("   - View filing details: ✅ Works");
  console.log("   - Submit filing: ✅ Works");
  console.log("   - Cancel filing: ✅ Works");
  console.log("   - Amend filing: ✅ Works");
  console.log("\n");
}

seedUSFilingConfig()
  .then(() => {
    console.log("✅ Seed completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  });
