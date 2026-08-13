import { db } from "@/lib/db";
import { applyTransition, FilingTransitionError } from "@/modules/filings/filingStateMachine";
import { findMostSpecificMatch } from "./wildcardLookup";
import { PgCanonicalMessageConsumer } from "./consumer";
import type { CanonicalFilingResponseData, CanonicalMessage } from "./types";

/**
 * Maps an inbound response's canonical status onto a FilingTransition via
 * FilingResponseStatusMapping, and applies it through
 * filingStateMachine.ts -- never writes CustomsFiling.filingStatus directly.
 * If no mapping row matches (deliberately absent for CANCELLED/ERROR today,
 * see scripts/seed-canonical-messaging.ts), or the transition isn't legal
 * from the filing's current status, the response is still recorded but the
 * status is left unchanged -- a bad or unexpected transition should never be
 * forced through.
 */
export async function processInboundMessage(message: CanonicalMessage<CanonicalFilingResponseData>): Promise<void> {
  const { header, data } = message;

  const filing = await db.customsFiling.findUnique({ where: { id: header.filingId } });
  if (!filing) {
    throw new Error(`Inbound response references unknown filingId "${header.filingId}" (messageId=${header.messageId}).`);
  }

  const candidates = await db.filingResponseStatusMapping.findMany({
    where: {
      country: { in: [header.country, "*"] },
      messageName: { in: [header.messageName, "*"] },
      canonicalStatus: data.status,
    },
  });
  const mapping = findMostSpecificMatch(candidates, ["country", "messageName"], {
    country: header.country,
    messageName: header.messageName,
  });

  let transitionApplied = false;
  if (mapping) {
    try {
      const nextStatus = applyTransition(filing.filingStatus, mapping.filingTransition as Parameters<typeof applyTransition>[1]);
      await db.customsFiling.update({ where: { id: filing.id }, data: { filingStatus: nextStatus } });
      transitionApplied = true;
    } catch (err) {
      // Both "the transition is illegal from this status" (FilingTransitionError)
      // and "filingTransition names no known transition at all" (a TypeError,
      // since applyTransition indexes TRANSITIONS by an unchecked string) land
      // here deliberately: bad config data must degrade to "record the
      // response, leave status alone," never crash message processing.
      const reason = err instanceof FilingTransitionError ? err.message : err instanceof Error ? err.message : String(err);
      console.warn(
        `[inboundConsumer] Response status "${data.status}" maps to transition "${mapping.filingTransition}", ` +
          `but it could not be applied to filing "${filing.id}" (currently "${filing.filingStatus}"). ` +
          `Recording the response without changing status. ${reason}`
      );
    }
  } else {
    console.warn(
      `[inboundConsumer] No FilingResponseStatusMapping for country="${header.country}", ` +
        `messageName="${header.messageName}", canonicalStatus="${data.status}". Recording the response without changing status.`
    );
  }

  // Preserves the existing CustomsResponse UI surface -- this used to be
  // written synchronously inside transmitFiling(); now it's written here,
  // whenever the (possibly stubbed) response actually arrives.
  await db.customsResponse.create({
    data: {
      accountId: filing.accountId,
      filingId: filing.id,
      code: data.status,
      title: transitionApplied ? `${data.status} — ${filing.filingStatus}` : data.status,
      description: data.humanMessage ?? `Canonical response received: ${data.status}`,
      status: data.status,
    },
  });
}

/** Drains every currently-pending inbound message once. Returns how many were processed. */
export async function drainInboundQueue(): Promise<number> {
  const consumer = new PgCanonicalMessageConsumer();
  let count = 0;
  // eslint-disable-next-line no-constant-condition
  while (await consumer.processOne(processInboundMessage)) count++;
  return count;
}
