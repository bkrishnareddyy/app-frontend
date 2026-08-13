/**
 * Long-running inbound-response worker. Polls FilingMessage for
 * INBOUND PENDING rows (see PgCanonicalMessageConsumer), same shape as
 * src/worker/pipelineWorker.ts's polling loop.
 *
 * Run with: npx tsx scripts/customs-filing-inbound-worker.ts
 */
import { PgCanonicalMessageConsumer } from "@/lib/canonicalMessaging/consumer";
import { processInboundMessage } from "@/lib/canonicalMessaging/inboundConsumer";

const POLL_INTERVAL_MS = 2000;

async function startWorker() {
  console.log("[customs-filing-inbound-worker] Starting...");
  const consumer = new PgCanonicalMessageConsumer();

  while (true) {
    let processedAny = false;
    try {
      processedAny = await consumer.processOne(processInboundMessage);
      if (processedAny) console.log("[customs-filing-inbound-worker] Processed one inbound message.");
    } catch (err) {
      console.error("[customs-filing-inbound-worker] Failed to process message:", err);
    }

    if (!processedAny) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

if (require.main === module) {
  startWorker().catch(console.error);
}

export { startWorker };
