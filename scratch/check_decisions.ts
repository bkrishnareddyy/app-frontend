import { db } from "../src/lib/db";

async function main() {
  console.log("=== LATEST 5 SHIPMENT DOCUMENTS ===");
  const docs = await db.shipmentDocument.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      docType: true,
      shipmentId: true,
      status: true,
      createdAt: true,
    },
  });
  console.log(JSON.stringify(docs, null, 2));

  console.log("\n=== LATEST 5 AGENT DECISIONS ===");
  const decisions = await db.agentDecision.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      agentName: true,
      status: true,
      confidence: true,
      decisionSummary: true,
      createdAt: true,
    },
  });
  console.log(JSON.stringify(decisions, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await db.$disconnect());
