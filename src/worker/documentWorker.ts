import { runWorkerTick } from "../modules/documents/processing/documentProcessingWorker";
import { runInboundEmailWorkerTick } from "../modules/documents/processing/inboundEmailWorker";
import { parserConfigurationReport, readProcessingLimits } from "../modules/documents/parser/config";

/**
 * Long-running Qubere document processing worker.
 *
 * The same `runWorkerTick()` (and `runInboundEmailWorkerTick()`) the cron
 * endpoints call, in a loop, for hosts that run a persistent process. All
 * state is in Postgres, so this process holds nothing: killing it mid-parse
 * loses no queued work, no provider task id, and no polling position — the
 * next tick (here or from a cron endpoint) reclaims anything whose heartbeat
 * went stale.
 *
 * This is also the practical way to get sub-daily processing without a
 * Vercel Cron slot: point it at the same DATABASE_URL as a deployed
 * environment (e.g. run it locally, or on any always-on host) and it drains
 * the same durable queues that environment's webhook/cron routes write to.
 * No separate scheduler needed — it's just a loop around the same idempotent
 * ticks.
 *
 * Run with: npx tsx src/worker/documentWorker.ts
 */

const IDLE_DELAY_MS = 5_000;
const ERROR_BACKOFF_MS = 30_000;

async function startDocumentWorker(): Promise<void> {
  const configuration = parserConfigurationReport();
  const limits = readProcessingLimits();

  console.log("[DocumentWorker] starting", {
    provider: configuration.provider,
    configured: configuration.configured,
    mock: configuration.mock,
    batchSize: limits.batchSize,
  });

  if (configuration.blocker !== null) {
    // Started anyway rather than exiting, so a deployment that fixes the
    // configuration does not also need a restart -- but the blocker is stated
    // loudly rather than the worker looking healthy while parsing nothing.
    console.error("[DocumentWorker] BLOCKED:", configuration.blocker);
  }

  for (;;) {
    try {
      const inboundEmailTick = await runInboundEmailWorkerTick();
      const tick = await runWorkerTick();

      const didInboundWork = inboundEmailTick.claimed > 0;
      if (didInboundWork) console.log("[DocumentWorker] inbound email tick", inboundEmailTick);

      if (tick.blocker !== null) {
        console.error("[DocumentWorker] tick blocked:", tick.blocker);
        await sleep(ERROR_BACKOFF_MS);
        continue;
      }

      const didWork =
        tick.submitted > 0 ||
        tick.polled > 0 ||
        tick.reclaimed.requeued > 0 ||
        tick.reclaimed.resumedPolling > 0 ||
        tick.pollTimeouts > 0;

      if (didWork) console.log("[DocumentWorker] tick", tick);

      // Idle sleep only when there was nothing to do; a busy queue keeps draining.
      if (!didWork && !didInboundWork) await sleep(IDLE_DELAY_MS);
    } catch (error) {
      // An unexpected throw here means a bug or a database outage. Log the code,
      // never the payload, and back off rather than spinning.
      console.error(
        "[DocumentWorker] tick failed:",
        error instanceof Error ? error.message : String(error)
      );
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  startDocumentWorker().catch((error) => {
    console.error("[DocumentWorker] fatal:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { startDocumentWorker };
