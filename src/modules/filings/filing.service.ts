import { db } from "@/lib/db";
import { computeFilingTariff, loadHtsCodesMap, type TariffEngineResult } from "@/lib/tariff/dutyEngine";
import { applyTransition, FilingTransitionError } from "./filingStateMachine";
import { buildCanonicalDeclaration } from "@/lib/canonicalMessaging/declarationBuilder";
import { resolveMessageContext } from "@/lib/canonicalMessaging/resolveMessageContext";
import { PgCanonicalMessagePublisher } from "@/lib/canonicalMessaging/publisher";
import { getActiveSchemaVersion } from "@/lib/canonicalMessaging/schemaValidator";
import { buildActionExtensions } from "@/lib/canonicalMessaging/actionDataRequirements";
import type { CanonicalCustomsDeclaration, CanonicalFilingRequestData, CanonicalMessage, FilingMessageAction } from "@/lib/canonicalMessaging/types";
import { randomUUID } from "crypto";

/** Shape frozen into FilingSnapshot.snapshotData at transmission. */
export type FilingSnapshotData = {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    portOfEntry: string | null;
    carrierName: string | null;
    incoterm: string | null;
    entryType: string | null;
  };
  lineItems: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
    totalValue: number;
    htsCode: string;
    countryOfOrigin: string;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    docType: string;
  }>;
  filingHeader: {
    entryNumber: string;
    entryType: string;
    totalValue: number;
    totalDuties: number;
    totalTaxes: number;
    totalAmount: number;
  };
  metadata: {
    generator: string;
    version: number;
    timestamp: string;
  };
};

export class FilingService {
  static async transmitFiling(accountId: string, userId: string, filingId: string) {
    return FilingService.buildSnapshotAndPublish(accountId, filingId, "SUBMIT", "transmit.send");
  }

  /**
   * Rebuilds the declaration from the shipment's *current* data (post-edit)
   * and publishes a RESUBMIT message referencing the filing's last outbound
   * message. Only legal from ValidationFailed/Rejected/DocumentsRequested --
   * see the `resubmit` transition added to filingStateMachine.ts for this.
   */
  static async resubmitFiling(accountId: string, userId: string, filingId: string) {
    const priorMessage = await db.filingMessage.findFirst({
      where: { filingId, accountId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!priorMessage) {
      throw new Error("Cannot resubmit: no prior outbound message found for this filing.");
    }
    return FilingService.buildSnapshotAndPublish(accountId, filingId, "RESUBMIT", "resubmit", priorMessage.messageId);
  }

  /**
   * Publishes a CANCELLATION message referencing the filing's last outbound
   * message, reusing its already-transmitted declaration rather than
   * rebuilding one -- a cancellation declares "cancel that specific
   * declaration," not a fresh snapshot of current (possibly since-changed)
   * shipment data.
   *
   * Applies `cancel.request` immediately (-> CancellationRequested) --
   * sending the message is itself a visible operator action, not something
   * that should leave filingStatus looking untouched until a response
   * happens to arrive. The confirmed `cbp.cancel` (-> Cancelled) only fires
   * once the response actually does, via FilingResponseStatusMapping.
   * Which statuses offer this action at all is FilingChildActionRule's job
   * (see resolveChildActions()), not this method's.
   */
  static async cancelFiling(
    accountId: string,
    userId: string,
    filingId: string,
    promptedValues: Record<string, unknown> = {}
  ) {
    const filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId },
      include: { shipment: true },
    });
    if (!filing) throw new Error("NOT_FOUND");

    const priorMessage = await db.filingMessage.findFirst({
      where: { filingId, accountId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!priorMessage) {
      throw new Error("Cannot cancel: no prior outbound message found for this filing.");
    }

    let nextStatus: string;
    try {
      nextStatus = applyTransition(filing.filingStatus, "cancel.request");
    } catch (error) {
      if (error instanceof FilingTransitionError) throw new Error(error.message);
      throw error;
    }

    const priorEnvelope = priorMessage.envelope as unknown as CanonicalMessage<CanonicalFilingRequestData>;
    const declaration = priorEnvelope.data.declaration;

    const context = await resolveMessageContext(
      { entryType: filing.entryType, destinationCountry: filing.shipment.destinationCountry },
      "CANCELLATION"
    );

    // Whatever this (country, procedure, action) needs beyond the reused
    // declaration -- e.g. a German NCTS guarantee reference. Never a branch
    // on country here: FilingActionDataRequirement decides what's needed,
    // this method only asks for it. Attached to the declaration's own
    // extensions bucket, not invented as a new envelope concept.
    const extensions = await buildActionExtensions(
      { country: context.country, procedureCode: context.procedure, messageName: context.messageName },
      "CANCELLATION",
      { filing, shipment: filing.shipment, declaration },
      promptedValues
    );
    const declarationWithExtensions: CanonicalCustomsDeclaration =
      Object.keys(extensions).length > 0 ? { ...declaration, extensions: { ...declaration.extensions, ...extensions } } : declaration;

    const message = await FilingService.buildMessage(
      accountId,
      filingId,
      filing.authority,
      context,
      declarationWithExtensions,
      priorMessage.messageId
    );
    await new PgCanonicalMessagePublisher().publish(context.queueName, message);

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: { filingStatus: nextStatus },
    });

    return { filing: updatedFiling, messageId: message.header.messageId };
  }

  private static async buildMessage(
    accountId: string,
    filingId: string,
    authority: string,
    context: Awaited<ReturnType<typeof resolveMessageContext>>,
    declaration: CanonicalCustomsDeclaration,
    priorMessageId?: string
  ): Promise<CanonicalMessage<CanonicalFilingRequestData>> {
    return {
      header: {
        messageId: randomUUID(),
        filingId,
        priorMessageId,
        messageName: context.messageName,
        direction: "OUTBOUND",
        customer: { accountId },
        procedure: context.procedure,
        country: context.country,
        authority,
        dateTime: new Date().toISOString(),
        // Reflects whichever FILING_REQUEST_DECLARATION version is actually
        // ACTIVE right now, not a value frozen at the time this code was
        // written -- a schema promotion (see seedSchemas()) must not leave
        // every subsequently published message claiming a stale version.
        schemaVersion: await getActiveSchemaVersion("FILING_REQUEST_DECLARATION"),
        senderSystem: "QUBERE",
      },
      data: { declaration },
    };
  }

  /**
   * Shared by transmitFiling (action SUBMIT) and resubmitFiling (action
   * RESUBMIT): validates line items are rated, rebuilds and persists a fresh
   * FilingSnapshot from the shipment's current data, builds the canonical
   * declaration, publishes, and applies the given FilingTransition.
   */
  private static async buildSnapshotAndPublish(
    accountId: string,
    filingId: string,
    action: FilingMessageAction,
    transition: Parameters<typeof applyTransition>[1],
    priorMessageId?: string
  ) {
    const filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId },
      include: {
        shipment: { include: { documents: true, lineItems: true } },
      },
    });

    if (!filing) {
      throw new Error("NOT_FOUND");
    }

    // The old guard only rejected two hardcoded statuses, so a Cancelled,
    // Rejected or unvalidated filing could still be transmitted.
    let nextStatus: string;
    try {
      nextStatus = applyTransition(filing.filingStatus, transition);
    } catch (error) {
      if (error instanceof FilingTransitionError) {
        throw new Error(error.message);
      }
      throw error;
    }

    if (!filing.shipment.lineItems || filing.shipment.lineItems.length === 0) {
      throw new Error("Cannot submit entry filing without line items.");
    }

    // An entry summary declares the duty owed. If any line has no published rate
    // the total understates that duty, and transmitting it is a misdeclaration.
    const tariff: TariffEngineResult = computeFilingTariff(
      filing.shipment.lineItems,
      await loadHtsCodesMap(filing.shipment.lineItems)
    );

    if (tariff.unratedLineCount > 0) {
      throw new Error(
        `Cannot transmit: ${tariff.unratedLineCount} of ${filing.shipment.lineItems.length} line(s) have no published duty rate, so the declared duty would understate the amount owed.`
      );
    }

    const snapshotData: FilingSnapshotData = {
      shipment: {
        id: filing.shipment.id,
        shipmentNumber: filing.shipment.shipmentNumber,
        importerName: filing.shipment.importerName,
        portOfEntry: filing.shipment.portOfEntry,
        carrierName: filing.shipment.carrierName,
        incoterm: filing.shipment.incoterm,
        entryType: filing.shipment.entryType,
      },
      lineItems: filing.shipment.lineItems.map(item => ({
        id: item.id,
        lineNumber: item.lineNumber,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalValue: Number(item.totalValue),
        htsCode: item.htsCode,
        countryOfOrigin: item.countryOfOrigin,
      })),
      documents: filing.shipment.documents.map(doc => ({
        id: doc.id,
        fileName: doc.fileName,
        docType: doc.docType,
      })),
      filingHeader: {
        entryNumber: filing.entryNumber,
        entryType: filing.entryType,
        totalValue: Number(filing.totalValue),
        totalDuties: Number(filing.totalDuties),
        totalTaxes: Number(filing.totalTaxes),
        totalAmount: Number(filing.totalAmount),
      },
      metadata: {
        generator: "Qubere Compliance Snapshot Engine",
        version: filing.version,
        timestamp: new Date().toISOString(),
      }
    };

    // FilingSnapshot.filingId is unique (one snapshot per filing, "current
    // effective state"), so a resubmit updates it rather than creating a
    // second row. The full history of what was actually sent at each point in
    // time still lives in FilingMessage.envelope, one immutable row per
    // message -- this snapshot is deliberately "latest," not an archive.
    const hasSection301 = tariff.lineResults.some((r) => r.section301Amount > 0);
    const htsCodesMapForSnapshot = await loadHtsCodesMap(filing.shipment.lineItems);
    const section301List = hasSection301
      ? (filing.shipment.lineItems
          .map((item) => (item.htsCode ? htsCodesMapForSnapshot[item.htsCode]?.section301Tranche : null))
          .find(Boolean) ?? null)
      : null;

    await db.filingSnapshot.upsert({
      where: { filingId },
      update: { snapshotData, hasSection301, section301List },
      create: { filingId, snapshotData, hasSection301, section301List },
    });

    // Build the canonical (country-agnostic) declaration and hand it to the
    // third-party filing service via the outbound queue. No CBP response
    // exists yet at this point -- it arrives later, asynchronously, and is
    // applied by the inbound consumer (see canonicalMessaging/inboundConsumer.ts).
    // This function intentionally does not return a response/transmissionResult.
    const declaration = await buildCanonicalDeclaration({
      accountId,
      filingId,
      shipmentId: filing.shipment.id,
      snapshotData,
      tariff,
    });

    const context = await resolveMessageContext(
      { entryType: filing.entryType, destinationCountry: filing.shipment.destinationCountry },
      action
    );

    const message = await FilingService.buildMessage(accountId, filingId, filing.authority, context, declaration, priorMessageId);

    await new PgCanonicalMessagePublisher().publish(context.queueName, message);

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: {
        filingStatus: nextStatus,
        submittedAt: new Date(),
        version: { increment: 1 },
      },
    });

    return { filing: updatedFiling, messageId: message.header.messageId };
  }
}
