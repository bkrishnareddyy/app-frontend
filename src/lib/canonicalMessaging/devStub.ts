import { db } from "@/lib/db";
import { PgCanonicalMessageConsumer } from "./consumer";
import { processInboundMessage } from "./inboundConsumer";
import type { CanonicalFilingRequestData, CanonicalFilingResponseData, CanonicalMessage } from "./types";

/**
 * DEV-ONLY: answers one specific just-published OUTBOUND message inline,
 * synchronously, instead of requiring `scripts/dev-stub-third-party.ts` to be
 * run by hand. Same simulated-acceptance behaviour, just scoped to a single
 * messageId (not "drain everything pending") so a shared dev database with
 * other filings' backlog can't get a response routed to the wrong message.
 *
 * A CANCELLATION is answered CANCELLED rather than ACCEPTED -- there's no
 * FilingResponseStatusMapping row for CANCELLED (see filingActionRules
 * changelog), so processInboundMessage() correctly records the response
 * without moving filingStatus, matching FilingService.cancelFiling()'s own
 * documented behaviour.
 *
 * Controlled by CUSTOMS_FILING_MOCK_RESPONSES (default on) so it's a single,
 * visible switch to flip off once a real third-party integration exists.
 */
export async function simulateThirdPartyResponse(outboundMessageId: string): Promise<boolean> {
  const pending = await db.filingMessage.findFirst({
    where: { messageId: outboundMessageId, direction: "OUTBOUND", queueStatus: "PENDING" },
  });
  if (!pending) return false;

  const request = pending.envelope as unknown as CanonicalMessage<CanonicalFilingRequestData>;
  const isCancellation = request.header.messageName.includes("CANCELLATION");
  const responseMessageId = `resp_${pending.messageId}`;

  const response: CanonicalMessage<CanonicalFilingResponseData> = {
    header: {
      messageId: responseMessageId,
      filingId: request.header.filingId,
      correlationId: request.header.messageId,
      messageName: "CUSTOMS_DECLARATION_RESPONSE",
      direction: "INBOUND",
      customer: request.header.customer,
      procedure: request.header.procedure,
      country: request.header.country,
      dateTime: new Date().toISOString(),
      schemaVersion: request.header.schemaVersion,
      senderSystem: "DEV_STUB_THIRD_PARTY",
    },
    data: isCancellation
      ? {
          status: "CANCELLED",
          humanMessage: "[DEV STUB] Simulated cancellation acknowledged -- no real authority transmission occurred.",
        }
      : {
          status: "ACCEPTED",
          authorityReference: `STUB-${Date.now()}`,
          humanMessage: "[DEV STUB] Simulated acceptance -- no real authority transmission occurred.",
        },
  };

  await db.$transaction([
    db.filingMessage.update({
      where: { id: pending.id },
      data: { queueStatus: "PROCESSED", processedAt: new Date() },
    }),
    db.filingMessage.create({
      data: {
        accountId: request.header.customer.accountId,
        filingId: request.header.filingId,
        messageId: responseMessageId,
        correlationId: request.header.messageId,
        messageName: "CUSTOMS_DECLARATION_RESPONSE",
        direction: "INBOUND",
        procedure: request.header.procedure,
        country: request.header.country,
        status: response.data.status,
        envelope: response as unknown as object,
        queueStatus: "PENDING",
      },
    }),
  ]);

  return true;
}

/** Answers the given message, then drains the inbound queue so the response is applied before the caller returns. */
export async function simulateAndApplyResponse(outboundMessageId: string): Promise<boolean> {
  if (process.env.CUSTOMS_FILING_MOCK_RESPONSES === "false") return false;

  const answered = await simulateThirdPartyResponse(outboundMessageId);
  if (!answered) return false;

  await new PgCanonicalMessageConsumer().consume("inbound", processInboundMessage);
  return true;
}
