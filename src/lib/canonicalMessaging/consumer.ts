import { db } from "@/lib/db";
import { validateAgainstActiveSchema, SchemaValidationError } from "./schemaValidator";
import type { CanonicalFilingResponseData, CanonicalMessage } from "./types";

export interface CanonicalMessageConsumer {
  consume(
    queueName: string,
    handler: (message: CanonicalMessage<CanonicalFilingResponseData>) => Promise<void>
  ): Promise<void>;
}

// Matches PipelineJob's stale-claim window in pgQueue.ts.

/**
 * Postgres-backed consumer. We only ever consume INBOUND messages -- the
 * third party consumes the outbound side, that's their infrastructure, not
 * ours. Claims one row at a time via FOR UPDATE SKIP LOCKED (same pattern as
 * PgQueue.dequeueNextJob), validates it against the active
 * FILING_RESPONSE_DATA schema, and hands it to the caller's handler.
 * A message that fails validation is marked FAILED, not silently dropped or
 * coerced -- see quarantine note in the design doc.
 */
export class PgCanonicalMessageConsumer implements CanonicalMessageConsumer {
  /** Claims and processes exactly one pending INBOUND message, if any. Returns whether one was found. */
  async processOne(
    handler: (message: CanonicalMessage<CanonicalFilingResponseData>) => Promise<void>
  ): Promise<boolean> {
    const claimed = await db.$queryRaw<any[]>`
      UPDATE "FilingMessage"
      SET "queueStatus" = 'CLAIMED', "lockedAt" = NOW()
      WHERE id = (
        SELECT id
        FROM "FilingMessage"
        WHERE "direction" = 'INBOUND'
          AND ("queueStatus" = 'PENDING' OR ("queueStatus" = 'CLAIMED' AND "lockedAt" < NOW() - INTERVAL '5 minutes'))
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, envelope, attempts;
    `;

    if (!claimed || claimed.length === 0) return false;
    const row = claimed[0];
    const message = row.envelope as CanonicalMessage<CanonicalFilingResponseData>;

    try {
      await validateAgainstActiveSchema("ENVELOPE_HEADER", message.header);
      await validateAgainstActiveSchema("FILING_RESPONSE_DATA", message.data);

      await handler(message);

      await db.filingMessage.update({
        where: { id: row.id },
        data: { queueStatus: "PROCESSED", processedAt: new Date(), status: message.data.status },
      });
    } catch (err) {
      const errorMessage = err instanceof SchemaValidationError ? err.message : err instanceof Error ? err.message : String(err);
      await db.filingMessage.update({
        where: { id: row.id },
        data: {
          queueStatus: "FAILED",
          errorMessage,
          attempts: { increment: 1 },
        },
      });
      throw err;
    }

    return true;
  }

  /**
   * Polls until no message is found, then returns. A caller that wants a
   * long-running worker (see scripts/customs-filing-inbound-worker.ts) loops
   * this with a sleep between empty polls; kept separate from that loop so
   * processOne() is independently testable and callable from an API route
   * for on-demand draining in local dev.
   */
  async consume(
    queueName: string,
    handler: (message: CanonicalMessage<CanonicalFilingResponseData>) => Promise<void>
  ): Promise<void> {
    void queueName; // routing hint for a real broker adapter; the Postgres adapter claims by direction only.
    // eslint-disable-next-line no-constant-condition
    while (await this.processOne(handler)) {
      // drain everything currently pending
    }
  }
}
