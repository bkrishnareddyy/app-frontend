/**
 * Drives the full transmit -> reject -> resubmit -> accept -> cancel ->
 * cancel-confirmed lifecycle against a real filing (created via the actual
 * UI) so its Response tab can be visually verified in the browser.
 *
 * Calls FilingService methods directly rather than the API routes: the
 * routes additionally gate on a document/classification-review validator
 * unrelated to what's being verified here (the Response tab's rendering of
 * FilingMessage history), so this exercises the same lifecycle logic
 * (FilingService + inboundConsumer, the real production code paths) without
 * hand-building an unrelated classification-review fixture.
 *
 * Run with: npx tsx scripts/drive-response-tab-demo.ts <filingId>
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { FilingService } from "../src/modules/filings/filing.service";
import { processInboundMessage } from "../src/lib/canonicalMessaging/inboundConsumer";
import type { CanonicalFilingResponseData, CanonicalMessage } from "../src/lib/canonicalMessaging/types";

const db = new PrismaClient();

/**
 * Creates the INBOUND FilingMessage row and applies it directly via
 * processInboundMessage, then marks the row PROCESSED itself -- rather than
 * going through PgCanonicalMessageConsumer.processOne's claim-by-raw-SQL path,
 * which was observed to hang under this shared dev Postgres pooler (see
 * changelog: a transient connection-pool contention issue, not a logic bug in
 * inboundConsumer.ts/filing.service.ts -- calling processInboundMessage
 * directly completes instantly every time).
 */
async function mockResponse(
  filingId: string,
  accountId: string,
  correlationMessageId: string,
  status: CanonicalFilingResponseData["status"],
  humanMessage: string
) {
  const message: CanonicalMessage<CanonicalFilingResponseData> = {
    header: {
      messageId: randomUUID(),
      filingId,
      correlationId: correlationMessageId,
      messageName: "CUSTOMS_DECLARATION_RESPONSE",
      direction: "INBOUND",
      customer: { accountId },
      procedure: "CBP-ABI",
      country: "US",
      authority: "US Customs (CBP)",
      dateTime: new Date().toISOString(),
      schemaVersion: "1.0.0",
      senderSystem: "MOCK_CBP",
    },
    data: { status, humanMessage },
  };

  await db.filingMessage.create({
    data: {
      accountId,
      filingId,
      messageId: message.header.messageId,
      correlationId: correlationMessageId,
      messageName: message.header.messageName,
      direction: "INBOUND",
      procedure: message.header.procedure,
      country: message.header.country,
      envelope: message as unknown as object,
      queueStatus: "CLAIMED",
      lockedAt: new Date(),
    },
  });

  await processInboundMessage(message);

  await db.filingMessage.update({
    where: { messageId: message.header.messageId },
    data: { queueStatus: "PROCESSED", processedAt: new Date(), status },
  });
}

async function main() {
  const filingId = process.argv[2];
  if (!filingId) throw new Error("Usage: npx tsx scripts/drive-response-tab-demo.ts <filingId>");

  let filing = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
  const accountId = filing.accountId;
  const shipmentId = filing.shipmentId;

  if (filing.filingStatus === "BrokerApproved") {
    const submitResult = await FilingService.transmitFiling(accountId, "demo-user", filingId);
    console.log("transmit ->", submitResult.filing.filingStatus);
    await mockResponse(filingId, accountId, submitResult.messageId, "REJECTED", "Missing certificate of origin.");
    console.log("mock REJECTED applied");
    filing = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
  }

  if (filing.filingStatus === "Rejected") {
    const items = await db.shipmentLineItem.findMany({ where: { shipmentId } });
    await db.shipmentLineItem.update({
      where: { id: items[0].id },
      data: { description: "Electronic Valves (Corrected)" },
    });

    const resubmitResult = await FilingService.resubmitFiling(accountId, "demo-user", filingId);
    console.log("resubmit ->", resubmitResult.filing.filingStatus);
    await mockResponse(filingId, accountId, resubmitResult.messageId, "ACCEPTED", "Entry accepted.");
    console.log("mock ACCEPTED applied");
    filing = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
  }

  if (filing.filingStatus !== "Accepted") {
    console.log("Filing is not in Accepted status (currently", filing.filingStatus, ") -- stopping before cancellation.");
    return;
  }

  const cancelResult = await FilingService.cancelFiling(accountId, "demo-user", filingId, {
    cancellationReason: "Filed in error",
    cancellationReasonCode: "1",
    requestedByBroker: true,
    affectedGoodsItems: [
      {
        lineNumber: 1,
        hsCode6: "848180",
        reasonForRemoval: "Filed in error",
        affectedPackages: [{ packageId: "PKG-1", weightKg: 12.5, quarantineHold: false }],
      },
    ],
  });
  console.log("cancel ->", cancelResult.filing.filingStatus);

  await mockResponse(filingId, accountId, cancelResult.messageId, "CANCELLED", "Cancellation confirmed by authority.");
  console.log("mock CANCELLED applied");

  const final = await db.customsFiling.findUniqueOrThrow({ where: { id: filingId } });
  console.log("final filingStatus:", final.filingStatus);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
