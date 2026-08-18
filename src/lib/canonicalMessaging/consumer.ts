import { db } from "@/lib/db";
import { validateAgainstActiveSchema, SchemaValidationError } from "./schemaValidator";
import { extractCanonicalResponseStatus } from "./responseStatus";
import type { CanonicalFilingResponseData, CanonicalMessage } from "./types";

export interface CanonicalMessageConsumer {
  consume(
    queueName: string,
    handler: (message: CanonicalMessage<CanonicalFilingResponseData>) => Promise<void>
  ): Promise<void>;
}

/**
 * Postgres-backed consumer for pending inbound canonical filing responses.
 */
export class PgCanonicalMessageConsumer implements CanonicalMessageConsumer {
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
        data: {
          queueStatus: "PROCESSED",
          processedAt: new Date(),
          status: extractCanonicalResponseStatus(message.data),
        },
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

  async consume(
    queueName: string,
    handler: (message: CanonicalMessage<CanonicalFilingResponseData>) => Promise<void>
  ): Promise<void> {
    void queueName;
    while (await this.processOne(handler)) {
      // drain currently pending messages
    }
  }
}
