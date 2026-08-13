import { db } from "../src/lib/db";

async function main() {
  console.log("Checking if unattached documents can be queried in db...");
  const docs = await db.shipmentDocument.findMany({
    where: { shipmentId: null },
    take: 5,
  });

  console.log(`Found ${docs.length} unattached documents in DB.`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
