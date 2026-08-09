import { db } from "../src/lib/db";

async function main() {
  const shipmentId = "cmsj8hbt0000sfxk9ukdudkhl";
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      documents: true,
      lineItems: true,
    },
  });
  console.log("SHIPMENT DATA:", JSON.stringify(shipment, null, 2));
}

main().catch(console.error);
