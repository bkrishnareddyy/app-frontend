import { inngest } from "../client";
import { MemoryExtractorWorker } from "@/modules/memory/memory.extractor";
import type { MemoryExtractionInput } from "@/modules/memory/memory.types";

/**
 * Event name for the memory write path's domain-event trigger (spec: "Domain
 * event -> Async Memory Worker"). Fired from /api/decisions on every human
 * review action -- previously that route called MemoryExtractorWorker
 * directly as an unawaited promise, which a serverless function can be frozen
 * mid-flight before completing, silently dropping the extraction. Routing
 * through Inngest (already used elsewhere in this codebase for durable
 * background work) gets the response back to the reviewer immediately while
 * guaranteeing -- with retries -- that the extraction actually runs.
 */
export const ACCOUNT_MEMORY_EXTRACTION_EVENT = "memory/human-decision.created";

export const accountMemoryExtractionJob = (inngest.createFunction as any)(
  { id: "account-memory-extraction", retries: 3, triggers: [{ event: ACCOUNT_MEMORY_EXTRACTION_EVENT }] },
  async ({ event, step }: { event: any; step: any }) => {
    const input = event.data as MemoryExtractionInput;
    return step.run("extract-account-memory", async () => {
      return MemoryExtractorWorker.processEvent(input);
    });
  }
);
