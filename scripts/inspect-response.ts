/**
 * Inspect the inbound message envelope to see the mock response structure
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: ["warn", "error"] });

async function main() {
  const filingId = "cmsx4fy0x000ded0we7xric71";

  const inboundMsg = await db.filingMessage.findFirst({
    where: {
      filingId,
      direction: "INBOUND",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!inboundMsg) {
    console.log("❌ No inbound message found");
    return;
  }

  console.log("\n📥 Inbound Message Details:");
  console.log(`   Message ID: ${inboundMsg.messageId}`);
  console.log(`   Correlation ID: ${inboundMsg.correlationId}`);
  console.log(`   Status: ${inboundMsg.status || "NULL"}`);
  console.log(`   Queue Status: ${inboundMsg.queueStatus}`);
  console.log(`   Created: ${inboundMsg.createdAt.toISOString()}`);
  console.log(`   Processed: ${inboundMsg.processedAt?.toISOString() || "NULL"}`);

  console.log("\n📦 Envelope Structure:");
  console.log(JSON.stringify(inboundMsg.envelope, null, 2));
}

main()
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
