import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function run() {
  const accounts = await db.account.findMany();
  console.log(`Seeding drawback lots for ${accounts.length} accounts...`);

  let count = 0;
  for (const acc of accounts) {
    const existing = await db.drawbackLot.count({
      where: { accountId: acc.id },
    });

    if (existing > 0) {
      console.log(`Account ${acc.name} already has drawback lots. Skipping.`);
      continue;
    }

    // Seed 3 lots per account
    await db.drawbackLot.createMany({
      data: [
        {
          accountId: acc.id,
          entryNumber: "ENT-2025-889901",
          htsCode: "8541.43.0010",
          quantity: 1000,
          availableQty: 1000,
          reservedQty: 0,
          claimedQty: 0,
          unitPurchasePrice: 85.50,
          dutyPaidPerUnit: 8.55, // 10% duty
          importDate: new Date("2025-06-15"),
          exportDeadline: new Date("2028-06-15"),
          hasSection301: true,
          section301List: "List3",
        },
        {
          accountId: acc.id,
          entryNumber: "ENT-2025-889902",
          htsCode: "8481.80.5090",
          quantity: 500,
          availableQty: 500,
          reservedQty: 0,
          claimedQty: 0,
          unitPurchasePrice: 120.00,
          dutyPaidPerUnit: 3.36, // 2.8% general rate
          importDate: new Date("2025-08-20"),
          exportDeadline: new Date("2028-08-20"),
          hasSection301: false,
        },
        {
          accountId: acc.id,
          entryNumber: "ENT-2025-889903",
          htsCode: "7318.15.2065",
          quantity: 5000,
          availableQty: 5000,
          reservedQty: 0,
          claimedQty: 0,
          unitPurchasePrice: 1.50,
          dutyPaidPerUnit: 0.093, // 6.2% rate
          importDate: new Date("2025-09-10"),
          exportDeadline: new Date("2028-09-10"),
          hasSection301: false,
        },
      ],
    });

    console.log(`Seeded 3 drawback lots for account: ${acc.name} (${acc.id})`);
    count += 3;
  }

  console.log(`Successfully completed seeding. Created ${count} drawback lots.`);
  await db.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
