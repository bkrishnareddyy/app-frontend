import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const filing = await db.customsFiling.findUnique({
    where: { id: "cmsxb36y00001edj0azbagdwi" },
    select: { dutyBreakdown: true },
  });

  console.log("📦 Stored Declaration Structure:");
  console.log(JSON.stringify(filing?.dutyBreakdown, null, 2));
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
