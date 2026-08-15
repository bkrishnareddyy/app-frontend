import { db } from "@/lib/db";
import { applyTransition, FilingTransitionError } from "@/modules/filings/filingStateMachine";
import { DrawbackService } from "@/modules/drawback/drawback.service";
import { PgCanonicalMessageConsumer } from "./consumer";
import type { CanonicalFilingResponseData, CanonicalMessage } from "./types";

/**
 * Processes inbound responses and updates filing status.
 * 
 * MULTI-COUNTRY MIGRATION NOTE:
 * FilingResponseStatusMapping table was dropped. Response status → state transition
 * mapping is now handled directly based on canonical status codes.
 * 
 * TODO: Implement proper state machine integration with new FilingActionConfiguration
 */
export async function processInboundMessage(message: CanonicalMessage<CanonicalFilingResponseData>): Promise<void> {
  const { header, data } = message;

  const filing = await db.customsFiling.findUnique({ where: { id: header.filingId } });
  if (!filing) {
    throw new Error(`Inbound response references unknown filingId "${header.filingId}" (messageId=${header.messageId}).`);
  }
  if (filing.accountId !== header.customer.accountId) {
    throw new Error(
      `Inbound message accountId "${header.customer.accountId}" does not match filing "${filing.id}"'s accountId "${filing.accountId}" (messageId=${header.messageId}).`
    );
  }

  // Direct status mapping (simplified until proper state machine integration)
  const statusTransitionMap: Record<string, Parameters<typeof applyTransition>[1] | null> = {
    "ACCEPTED": "cbp.accept",
    "REJECTED": "cbp.reject",
    "RELEASED": "cbp.release",
    "CANCELLED": null, // No automatic transition
    "ERROR": null, // No automatic transition
  };

  let transitionApplied = false;
  let newFilingStatus = filing.filingStatus;

  const transition = statusTransitionMap[data.status];
  if (transition) {
    try {
      newFilingStatus = applyTransition(filing.filingStatus, transition);
      await db.customsFiling.update({ where: { id: filing.id }, data: { filingStatus: newFilingStatus } });
      transitionApplied = true;
    } catch (err) {
      const reason = err instanceof FilingTransitionError ? err.message : err instanceof Error ? err.message : String(err);
      console.warn(
        `[inboundConsumer] Response status "${data.status}" maps to transition "${transition}", ` +
          `but it could not be applied to filing "${filing.id}" (currently "${filing.filingStatus}"). ` +
          `Recording the response without changing status. ${reason}`
      );
    }
  } else {
    console.warn(
      `[inboundConsumer] No automatic transition for canonicalStatus="${data.status}". Recording the response without changing status.`
    );
  }

  // Preserves the existing CustomsResponse UI surface
  await db.customsResponse.create({
    data: {
      accountId: filing.accountId,
      filingId: filing.id,
      code: data.status,
      title: transitionApplied ? `${data.status} — ${newFilingStatus}` : data.status,
      description: data.humanMessage ?? `Canonical response received: ${data.status}`,
      status: data.status,
    },
  });

  // Task B-2 & D-6: Actions on filing acceptance
  if (newFilingStatus === "Accepted" || data.status === "ACCEPTED") {
    // 1. Create DrawbackLots from accepted filing (Task B-2)
    try {
      await DrawbackService.createDrawbackLotsFromFiling(filing.id);
    } catch (err) {
      console.warn(`[inboundConsumer] Failed to create drawback lots for accepted filing ${filing.id}:`, err);
    }

    // 2. Create PSC_WINDOW ComplianceDeadline (300 days from summary/acceptance date) (Task D-6)
    try {
      const anchorDate = new Date();
      const pscDueDate = new Date(anchorDate.getTime() + 300 * 24 * 60 * 60 * 1000); // 300 days

      const existingDeadline = await db.complianceDeadline.findFirst({
        where: { accountId: filing.accountId, shipmentId: filing.shipmentId, type: "PSC_WINDOW" },
      });

      if (!existingDeadline) {
        await db.complianceDeadline.create({
          data: {
            accountId: filing.accountId,
            shipmentId: filing.shipmentId,
            type: "PSC_WINDOW",
            deadlineClass: "REGULATORY",
            status: "OPEN",
            anchorEvent: "ENTRY",
            anchorAt: anchorDate,
            dueAt: pscDueDate,
            ruleId: "PSC_WINDOW_300_DAYS",
            ruleCitation: "19 CFR 174.12",
          },
        });
      }
    } catch (err) {
      console.warn(`[inboundConsumer] Failed to create PSC_WINDOW compliance deadline for filing ${filing.id}:`, err);
    }
  }

  // Task D-6: Create an ExceptionItem when a filing is rejected by authority
  if (data.status === "REJECTED") {
    await db.exceptionItem.create({
      data: {
        accountId: filing.accountId,
        shipmentId: filing.shipmentId,
        filingId: filing.id,
        category: "FILING",
        type: "compliance_flag",
        severity: "High",
        description: data.humanMessage ?? `Customs filing ${filing.entryNumber} was rejected by authority.`,
        status: "Open",
        blocking: true,
        requiredAction: "Review filing rejection codes and resubmit declaration.",
        sourceAgent: "CANONICAL_MESSAGING_CONSUMER",
      },
    });
  }
}

/** Drains every currently-pending inbound message once. Returns how many were processed. */
export async function drainInboundQueue(): Promise<number> {
  const consumer = new PgCanonicalMessageConsumer();
  let count = 0;
   
  while (await consumer.processOne(processInboundMessage)) count++;
  return count;
}
