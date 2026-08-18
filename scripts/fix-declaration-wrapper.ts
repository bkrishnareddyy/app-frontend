/**
 * Fix the declaration data for the existing test filing
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const filingId = "cmsx4fy0x000ded0we7xric71";

  const filing = await db.customsFiling.findUnique({
    where: { id: filingId },
    select: { dutyBreakdown: true, transactionType: { select: { code: true } } },
  });

  if (!filing) {
    console.log("❌ Filing not found");
    return;
  }

  const storedData = filing.dutyBreakdown as any;
  if (!storedData?.declarationDraft) {
    console.log("❌ No declaration data found");
    return;
  }

  const declaration = storedData.declarationDraft;

  // Check if already wrapped
  if (declaration.ImportDeclaration || declaration.ExportDeclaration) {
    console.log("✅ Declaration is already wrapped");
    console.log(JSON.stringify(declaration, null, 2));
    return;
  }

  // Wrap it
  const transactionType = filing.transactionType?.code || "IMPORT";
  const isImport = transactionType.toUpperCase().includes("IMPORT");
  const wrapperKey = isImport ? "ImportDeclaration" : "ExportDeclaration";

  const wrappedDeclaration = {
    [wrapperKey]: declaration
  };

  // Update in database
  await db.customsFiling.update({
    where: { id: filingId },
    data: {
      dutyBreakdown: {
        declarationDraft: wrappedDeclaration
      },
      filingStatus: "BrokerApproved", // Reset to allow re-transmission
    },
  });

  console.log(`✅ Declaration wrapped in ${wrapperKey}`);
  console.log(JSON.stringify({ declarationDraft: wrappedDeclaration }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
