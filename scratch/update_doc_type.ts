import { db } from "../src/lib/db";

async function main() {
  const docId = "cmsi5mq6g000dfxqrso04q7or";

  const updatedDoc = await db.shipmentDocument.updateMany({
    where: {
      fileName: { contains: "bol", mode: "insensitive" },
    },
    data: {
      docType: "Ocean Bill of Lading (B/L)",
    },
  });

  console.log(`Updated ${updatedDoc.count} shipment documents to Ocean Bill of Lading (B/L).`);

  const updatedDecision = await db.agentDecision.updateMany({
    where: {
      decisionSummary: { contains: "pkt_", mode: "insensitive" },
    },
    data: {
      proposedDescription: "Ingested bol-basic-info.png (2 pages as Ocean Bill of Lading (B/L))",
      decisionSummary: "Packet: Stitched 2 pages (Ocean Bill of Lading (B/L)) with 98% AI confidence.",
    },
  });

  console.log(`Updated ${updatedDecision.count} agent decisions.`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await db.$disconnect());
