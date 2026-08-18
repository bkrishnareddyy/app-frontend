import { db } from "@/lib/db";
import { computeFilingTariff, loadHtsCodesMap, type TariffEngineResult } from "@/lib/tariff/dutyEngine";
import { applyTransition, FilingTransitionError } from "./filingStateMachine";
import { buildCanonicalDeclaration, wrapDeclarationData } from "@/lib/canonicalMessaging/declarationBuilder";
import { resolveMessageContext } from "@/lib/canonicalMessaging/resolveMessageContext";
import { PgCanonicalMessagePublisher } from "@/lib/canonicalMessaging/publisher";
import { getActiveSchemaVersion } from "@/lib/canonicalMessaging/schemaValidator";
import { buildActionExtensions } from "@/lib/canonicalMessaging/actionDataRequirements";
import type {
  CanonicalFilingRequestData,
  CanonicalMessage,
  FilingMessageAction,
  DeclarationData,
} from "@/lib/canonicalMessaging/types";
import { randomUUID } from "crypto";

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

function withActionExtensions(declaration: DeclarationData, extensions: Record<string, unknown>): DeclarationData {
  if (Object.keys(extensions).length === 0) return declaration;
  const current = declaration as Record<string, any>;
  return {
    ...current,
    extensions: {
      ...(current.extensions && typeof current.extensions === "object" ? current.extensions : {}),
      ...extensions,
    },
  };
}

export class FilingService {
  static async transmitFiling(accountId: string, userId: string, filingId: string) {
    return FilingService.buildSnapshotAndPublish(accountId, filingId, "SUBMIT", "transmit.send", undefined, userId);
  }

  static async resubmitFiling(accountId: string, userId: string, filingId: string) {
    const priorMessage = await db.filingMessage.findFirst({
      where: { filingId, accountId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!priorMessage) throw new Error("Cannot resubmit: no prior outbound message found for this filing.");
    return FilingService.buildSnapshotAndPublish(accountId, filingId, "RESUBMIT", "resubmit", priorMessage.messageId, userId);
  }

  static async cancelFiling(
    accountId: string,
    userId: string,
    filingId: string,
    promptedValues: Record<string, unknown> = {}
  ) {
    const filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId },
      include: { shipment: true, transactionType: true },
    });
    if (!filing) throw new Error("NOT_FOUND");

    const priorMessage = await db.filingMessage.findFirst({
      where: { filingId, accountId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!priorMessage) throw new Error("Cannot cancel: no prior outbound message found for this filing.");

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
      {
        transactionType: filing.transactionType?.code || "IMPORT",
        procedureCode: filing.procedureCode || filing.entryType || "01",
        country: filing.country || filing.shipment?.destinationCountry || "US",
      },
      "CANCELLATION"
    );

    const extensions = await buildActionExtensions(
      { country: context.country, procedureCode: context.procedure, messageName: context.messageName },
      "CANCELLATION",
      { filing, shipment: filing.shipment, declaration },
      promptedValues
    );
    const declarationWithExtensions = withActionExtensions(declaration, extensions);

    const message = await FilingService.buildMessage(
      accountId,
      filingId,
      filing.authority || "Customs",
      context,
      declarationWithExtensions,
      priorMessage.messageId
    );
    await new PgCanonicalMessagePublisher().publish("filing-outbound-queue", message);

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: { filingStatus: nextStatus },
    });

    void userId;
    return { filing: updatedFiling, messageId: message.header.messageId };
  }

  private static async buildMessage(
    accountId: string,
    filingId: string,
    authority: string,
    context: Awaited<ReturnType<typeof resolveMessageContext>>,
    declaration: DeclarationData,
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
        schemaVersion: await getActiveSchemaVersion("FILING_REQUEST_DECLARATION"),
        senderSystem: "QUBERE",
      },
      data: { declaration },
    };
  }

  private static async buildSnapshotAndPublish(
    accountId: string,
    filingId: string,
    action: FilingMessageAction,
    transition: Parameters<typeof applyTransition>[1],
    priorMessageId?: string,
    userId?: string
  ) {
    const filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId },
      include: {
        shipment: { include: { documents: true, lineItems: true } },
        transactionType: true,
      },
    });
    if (!filing) throw new Error("NOT_FOUND");

    const isStandalone = !filing.shipmentId;
    let nextStatus: string;
    try {
      nextStatus = applyTransition(filing.filingStatus, transition);
    } catch (error) {
      if (error instanceof FilingTransitionError) throw new Error(error.message);
      throw error;
    }

    let declaration: DeclarationData;
    let snapshotData: FilingSnapshotData | null = null;

    if (isStandalone) {
      const storedData = filing.dutyBreakdown as any;
      if (!storedData?.declarationDraft) throw new Error("Cannot submit standalone filing without declaration data.");
      declaration = wrapDeclarationData(storedData.declarationDraft, filing.transactionType?.code || "IMPORT");
    } else {
      const shipment = filing.shipment;
      if (!shipment || shipment.lineItems.length === 0) {
        throw new Error("Cannot submit entry filing without line items.");
      }

      const country = (filing.country || shipment.destinationCountry || "US").toUpperCase();
      let tariff: TariffEngineResult;

      if (country === "US") {
        tariff = computeFilingTariff(shipment.lineItems, await loadHtsCodesMap(shipment.lineItems));
        if (tariff.unratedLineCount > 0) {
          throw new Error(`Cannot transmit: ${tariff.unratedLineCount} of ${shipment.lineItems.length} line(s) have no published duty rate, so the declared duty would understate the amount owed.`);
        }
      } else {
        const totalValue = shipment.lineItems.reduce((sum, item) => sum + Number(item.totalValue || 0), 0);
        tariff = {
          totalCustomsValue: totalValue,
          totalDuty: 0,
          totalTaxes: 0,
          totalFees: 0,
          totalAmount: totalValue,
          unratedLineCount: 0,
          dutyBreakdown: [],
          lineResults: shipment.lineItems.map((item) => ({
            customsValue: Number(item.totalValue || 0),
            baseDutyRate: null,
            baseDutyAmount: 0,
            section301Rate: 0,
            section301Amount: 0,
            section232Rate: 0,
            section232Amount: 0,
            totalDutyAmount: 0,
            mpfAmount: 0,
            hmfAmount: 0,
            totalFeesAmount: 0,
            totalAmount: Number(item.totalValue || 0),
          })),
        };
      }

      snapshotData = {
        shipment: {
          id: shipment.id,
          shipmentNumber: shipment.shipmentNumber,
          importerName: shipment.importerName,
          portOfEntry: shipment.portOfEntry,
          carrierName: shipment.carrierName,
          incoterm: shipment.incoterm,
          entryType: shipment.entryType,
        },
        lineItems: shipment.lineItems.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          totalValue: Number(item.totalValue),
          htsCode: item.htsCode,
          countryOfOrigin: item.countryOfOrigin,
        })),
        documents: shipment.documents.map((doc) => ({ id: doc.id, fileName: doc.fileName, docType: doc.docType })),
        filingHeader: {
          entryNumber: filing.entryNumber,
          entryType: filing.entryType || "01",
          totalValue: Number(filing.totalValue),
          totalDuties: Number(filing.totalDuties),
          totalTaxes: Number(filing.totalTaxes),
          totalAmount: Number(filing.totalAmount),
        },
        metadata: {
          generator: "Qubere Compliance Snapshot Engine",
          version: filing.version,
          timestamp: new Date().toISOString(),
        },
      };

      const hasSection301 = tariff.lineResults.some((result) => result.section301Amount > 0);
      const htsCodesMapForSnapshot = await loadHtsCodesMap(shipment.lineItems);
      const section301List = hasSection301
        ? (shipment.lineItems
            .map((item) => (item.htsCode ? htsCodesMapForSnapshot[item.htsCode]?.section301Tranche : null))
            .find(Boolean) ?? null)
        : null;

      await db.filingSnapshot.upsert({
        where: { filingId },
        update: { snapshotData: snapshotData as any, hasSection301, section301List },
        create: { filingId, snapshotData: snapshotData as any, hasSection301, section301List },
      });

      declaration = await buildCanonicalDeclaration({
        accountId,
        filingId,
        shipmentId: shipment.id,
        snapshotData,
        tariff,
        localReferenceNumber: filing.localReferenceNumber,
        registrationNumber: filing.registrationNumber,
      });
    }

    const context = await resolveMessageContext(
      {
        transactionType: filing.transactionType?.code || "IMPORT",
        procedureCode: filing.procedureCode || filing.entryType || "01",
        country: filing.country || filing.shipment?.destinationCountry || "US",
      },
      action
    );

    const message = await FilingService.buildMessage(
      accountId,
      filingId,
      filing.authority || "Customs",
      context,
      declaration,
      priorMessageId
    );
    await new PgCanonicalMessagePublisher().publish("filing-outbound-queue", message);

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: {
        filingStatus: nextStatus,
        submittedAt: new Date(),
        version: { increment: 1 },
        ...(userId && action === "SUBMIT" ? { transmittedByUserId: userId } : {}),
      },
    });

    return { filing: updatedFiling, messageId: message.header.messageId };
  }
}
