/**
 * Verify US filing configuration data
 */

import { db } from "../src/lib/db";

async function verifyUSConfig() {
  console.log("🔍 Verifying US Configuration Data...\n");

  // Count procedures
  const procedureCount = await db.filingProcedureConfig.count({
    where: { country: "US" }
  });
  
  // Count action mappings
  const actionMappingCount = await db.filingActionMessageMapping.count({
    where: { country: "US" }
  });
  
  // Count action configs
  const actionConfigCount = await db.filingActionConfiguration.count({
    where: { country: "US" }
  });

  console.log("📊 Row Counts:");
  console.log(`   FilingProcedureConfig (US): ${procedureCount}`);
  console.log(`   FilingActionMessageMapping (US): ${actionMappingCount}`);
  console.log(`   FilingActionConfiguration (US): ${actionConfigCount}`);
  console.log(`   Total US rows: ${procedureCount + actionMappingCount + actionConfigCount}\n`);

  // Sample data
  const sampleProcedures = await db.filingProcedureConfig.findMany({
    where: { country: "US" },
    take: 5,
    select: {
      procedureCode: true,
      messageName: true,
      transactionType: {
        select: { code: true }
      }
    }
  });

  console.log("📋 Sample Procedures:");
  sampleProcedures.forEach(p => {
    console.log(`   ${p.procedureCode} → ${p.messageName} (${p.transactionType.code})`);
  });

  // Check if entry type "01" works
  console.log("\n🔍 Testing Entry Type '01' (most common):");
  const config01 = await db.filingProcedureConfig.findUnique({
    where: {
      country_procedureCode_messageName: {
        country: "US",
        procedureCode: "01",
        messageName: "CBP_ENTRY_7501"
      }
    }
  });

  if (config01) {
    console.log("   ✅ Entry Type 01 configuration found");
  } else {
    console.log("   ❌ Entry Type 01 configuration NOT found");
  }

  // Check action mappings for 01
  const actionMapping01 = await db.filingActionMessageMapping.findUnique({
    where: {
      country_procedureCode_action: {
        country: "US",
        procedureCode: "01",
        action: "SUBMIT"
      }
    }
  });

  if (actionMapping01) {
    console.log("   ✅ SUBMIT action mapping found for Entry Type 01");
  } else {
    console.log("   ❌ SUBMIT action mapping NOT found");
  }

  console.log("\n✅ Verification complete!");
}

verifyUSConfig()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  });
