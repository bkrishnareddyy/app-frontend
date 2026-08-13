import { db } from "@/lib/db";
import { validateAgainstActiveSchema } from "./schemaValidator";
import type { CanonicalFilingRequestData, CanonicalMessage } from "./types";

export interface CanonicalMessagePublisher {
  publish(queueName: string, message: CanonicalMessage<CanonicalFilingRequestData>): Promise<void>;
}

/**
 * Postgres-backed publisher: writes an OUTBOUND row into FilingMessage
 * with queueStatus PENDING. That table doubles as the queue (see the model
 * comment in schema.prisma) so "publish" here just means "durably persist,
 * ready to be claimed" -- no broker SDK involved. Swapping in RabbitMQ/Kafka/
 * ActiveMQ later means writing a new class implementing this same interface;
 * nothing that calls publish() needs to change.
 */
export class PgCanonicalMessagePublisher implements CanonicalMessagePublisher {
  async publish(queueName: string, message: CanonicalMessage<CanonicalFilingRequestData>): Promise<void> {
    await validateAgainstActiveSchema("ENVELOPE_HEADER", message.header);
    await validateAgainstActiveSchema("FILING_REQUEST_DECLARATION", message.data.declaration);

    await db.filingMessage.create({
      data: {
        accountId: message.header.customer.accountId,
        filingId: message.header.filingId,
        messageId: message.header.messageId,
        priorMessageId: message.header.priorMessageId,
        messageName: message.header.messageName,
        direction: "OUTBOUND",
        procedure: message.header.procedure,
        country: message.header.country,
        envelope: message as unknown as object,
        queueStatus: "PENDING",
      },
    });
    // queueName is the interface's routing hint for a real broker adapter;
    // the Postgres adapter doesn't need a separate topic per queue name today,
    // but keeping it in the signature means a Kafka/RabbitMQ adapter that DOES
    // need it is a drop-in swap, not a signature change.
    void queueName;
  }
}
