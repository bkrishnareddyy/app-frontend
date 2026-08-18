/**
 * Quick script to transition filing status for testing
 * Run with: npx tsx scripts/update-filing-status.ts <filing-id> <status>
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: ["warn", "error"] });

async function main() {
  const filingId = process.argv[2];
  const newStatus = process.argv[3];

  if (!filingId || !newStatus) {
    console.log("Usage: npx tsx scripts/update-filing-status.ts <filing-id> <status>");
    console.log("\nAvailable statuses:");
    console.log("  - BrokerApproved (ready to transmit)");
    console.log("  - ReadyForBrokerReview");
    console.log("  - Draft");
    process.exit(1);
  }

  const filing = await db.customsFiling.findUnique({
    where: { id: filingId },
    select: { id: true, entryNumber: true, filingStatus: true, localReferenceNumber: true },
  });

  if (!filing) {
    console.log(`❌ Filing not found: ${filingId}`);
    process.exit(1);
  }

  console.log(`\n📄 Current Filing:`);
  console.log(`   ID: ${filing.id}`);
  console.log(`   Entry Number: ${filing.entryNumber}`);
  console.log(`   Local Reference Number: ${filing.localReferenceNumber}`);
  console.log(`   Current Status: ${filing.filingStatus}`);

  await db.customsFiling.update({
    where: { id: filingId },
    data: { filingStatus: newStatus },
  });

  console.log(`\n✅ Status updated to: ${newStatus}`);
  console.log(`\nYou can now transmit this filing from the UI!\n`);
}

main()
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
