import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeFilingTariff, loadHtsCodesMap, type TariffEngineResult } from "@/lib/tariff/dutyEngine";
import { applyTransition, FilingTransitionError } from "./filingStateMachine";
import { buildCanonicalDeclaration, wrapDeclarationData } from "@/lib/canonicalMessaging/declarationBuilder";
import { resolveMessageContext } from "@/lib/canonicalMessaging/resolveMessageContext";
import { PgCanonicalMessagePublisher } from "@/lib/canonicalMessaging/publisher";
import { getActiveSchemaVersion } from "@/lib/canonicalMessaging/schemaValidator";
import { buildActionExtensions } from "@/lib/canonicalMessaging/actionDataRequirements";
import { extractedCurrencies } from "@/modules/documents/extractedCurrency";
import {
  convertTariffLines,
  resolveFilingCurrencyContext,
  type FilingCurrencyContext,
} from "@/lib/canonicalMessaging/currencyContext";
import type {
  CanonicalFilingRequestData,
  CanonicalMessage,
  FilingMessageAction,
  DeclarationData,
} from "@/lib/canonicalMessaging/types";
import { randomUUID } from "crypto";

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

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
    destinationCountry: string | null;
    countryOfExport: string | null;
    estimatedArrival: Date | string | null;
    ladingDate: Date | string | null;
    arrivalDate: Date | string | null;
    transportMode: string | null;
    status: string;
    currentStage: string | null;
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
  currency: FilingCurrencyContext;
  filingHeader: {
    entryNumber: string;
    entryType: string;
    commercialTotalValue: number;
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
    return FilingService.buildSnapshotAndPublish(
      accountId,
      filingId,
      "SUBMIT",
      "transmit.send",
      undefined,
      userId
    );
  }

  static async resubmitFiling(accountId: string, userId: string, filingId: string) {
    const priorMessage = await db.filingMessage.findFirst({
      where: { filingId, accountId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!priorMessage) {
      throw new Error("Cannot resubmit: no prior outbound message found for this filing.");
    }
    return FilingService.buildSnapshotAndPublish(
      accountId,
      filingId,
      "RESUBMIT",
      "resubmit",
      priorMessage.messageId,
      userId
    );
  }

  static async cancelFiling(
    accountId: string,
    userId: string,
    filingId: string,
    promptedValues: Record<string, unknown> = {}
  ) {
    const filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId },
      include: {
        shipment: true,
        transactionType: true,
      },
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
    let computedTariff: TariffEngineResult | null = null;
    let frozenCurrency: FilingCurrencyContext | null = null;

    if (isStandalone) {
      const storedData = filing.dutyBreakdown as any;
      if (!storedData?.declarationDraft) {
        throw new Error("Cannot submit standalone filing without declaration data.");
      }

      const transactionType = filing.transactionType?.code || "IMPORT";
      declaration = wrapDeclarationData(storedData.declarationDraft, transactionType);
    } else {
      if (!filing.shipment?.lineItems || filing.shipment.lineItems.length === 0) {
        throw new Error("Cannot submit entry filing without line items.");
      }

      const country = (filing.country || filing.shipment.destinationCountry || "US").toUpperCase();
      const storedFilingData =
        filing.dutyBreakdown && !Array.isArray(filing.dutyBreakdown)
          ? (filing.dutyBreakdown as Record<string, unknown>)
          : {};
      const storedCurrencyContext = storedFilingData.currencyContext as
        | Record<string, unknown>
        | undefined;
      const detectedCurrencies = extractedCurrencies(filing.shipment.documents);

      if (detectedCurrencies.length > 1 && !storedCurrencyContext?.commercialCurrency) {
        throw new Error(
          `Cannot transmit: commercial invoice documents disagree on currency (${detectedCurrencies.join(", ")}). Resolve the filing commercial currency before submission.`
        );
      }

      const detectedCommercialCurrency =
        detectedCurrencies.length === 1 ? detectedCurrencies[0] : null;
      const currencyInput = storedCurrencyContext
        ? storedFilingData
        : {
            ...storedFilingData,
            currencyContext: detectedCommercialCurrency
              ? { commercialCurrency: detectedCommercialCurrency }
              : undefined,
          };

      frozenCurrency = resolveFilingCurrencyContext(country, currencyInput as any);
      const tariffLines = convertTariffLines(filing.shipment.lineItems, frozenCurrency);

      if (country === "US") {
        const htsCodesMap = await loadHtsCodesMap(tariffLines, country);
        computedTariff = computeFilingTariff(tariffLines, htsCodesMap);

        if (computedTariff.unratedLineCount > 0) {
          throw new Error(
            `Cannot transmit: ${computedTariff.unratedLineCount} of ${filing.shipment.lineItems.length} line(s) have no published duty rate, so the declared duty would understate the amount owed.`
          );
        }
      } else {
        const convertedValues = tariffLines.map((item) => Number(item.totalValue || 0));
        const totalCustomsValue = convertedValues.reduce((sum, value) => sum + value, 0);

        computedTariff = {
          totalCustomsValue,
          totalDuty: 0,
          totalTaxes: 0,
          totalFees: 0,
          totalAmount: totalCustomsValue,
          unratedLineCount: 0,
          dutyBreakdown: [],
          lineResults: tariffLines.map((item) => ({
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

      const commercialTotalValue = filing.shipment.lineItems.reduce(
        (sum, item) => sum + Number(item.totalValue || 0),
        0
      );

      snapshotData = {
        shipment: {
          id: filing.shipment.id,
          shipmentNumber: filing.shipment.shipmentNumber,
          importerName: filing.shipment.importerName,
          portOfEntry: filing.shipment.portOfEntry,
          carrierName: filing.shipment.carrierName,
          incoterm: filing.shipment.incoterm,
          entryType: filing.shipment.entryType,
          destinationCountry: filing.shipment.destinationCountry,
          countryOfExport: filing.shipment.countryOfExport,
          estimatedArrival: filing.shipment.estimatedArrival,
          ladingDate: filing.shipment.ladingDate,
          arrivalDate: filing.shipment.arrivalDate,
          transportMode: filing.shipment.transportMode,
          status: filing.shipment.status,
          currentStage: filing.shipment.currentStage,
        },
        lineItems: filing.shipment.lineItems.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          totalValue: Number(item.totalValue),
          htsCode: item.htsCode,
          countryOfOrigin: item.countryOfOrigin,
        })),
        documents: filing.shipment.documents.map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          docType: doc.docType,
        })),
        currency: frozenCurrency,
        filingHeader: {
          entryNumber: filing.entryNumber,
          entryType: filing.entryType || "01",
          commercialTotalValue,
          totalValue: computedTariff.totalCustomsValue,
          totalDuties: computedTariff.totalDuty,
          totalTaxes: computedTariff.totalTaxes,
          totalAmount: computedTariff.totalAmount,
        },
        metadata: {
          generator: "Qubere Compliance Snapshot Engine",
          version: filing.version,
          timestamp: new Date().toISOString(),
        },
      };

      const hasSection301 = computedTariff.lineResults.some((r) => r.section301Amount > 0);
      const htsCodesMapForSnapshot = await loadHtsCodesMap(tariffLines, country);
      const section301List = hasSection301
        ? (filing.shipment.lineItems
            .map((item) =>
              item.htsCode ? htsCodesMapForSnapshot[item.htsCode]?.section301Tranche : null
            )
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
        shipmentId: filing.shipment.id,
        snapshotData,
        tariff: computedTariff,
        localReferenceNumber: filing.localReferenceNumber,
        registrationNumber: filing.registrationNumber,
      });
    }

    const context = await resolveMessageContext(
      {
        transactionType: filing.transactionType?.code || "IMPORT",
        procedureCode: filing.procedureCode || filing.entryType || "01",
        country:
          filing.country ||
          (isStandalone ? "US" : filing.shipment?.destinationCountry) ||
          "US",
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

    const existingDutyData =
      filing.dutyBreakdown && !Array.isArray(filing.dutyBreakdown)
        ? (filing.dutyBreakdown as Record<string, unknown>)
        : {};

    const financialUpdate = computedTariff
      ? asInputJson({
          ...existingDutyData,
          fees: computedTariff.dutyBreakdown,
          currencyContext: frozenCurrency,
        })
      : undefined;

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: {
        filingStatus: nextStatus,
        submittedAt: new Date(),
        version: { increment: 1 },
        ...(computedTariff
          ? {
              totalValue: computedTariff.totalCustomsValue,
              totalDuties: computedTariff.totalDuty,
              totalTaxes: computedTariff.totalTaxes,
              totalAmount: computedTariff.totalAmount,
              dutyBreakdown: financialUpdate,
            }
          : {}),
        ...(userId && action === "SUBMIT" ? { transmittedByUserId: userId } : {}),
      },
    });

    return { filing: updatedFiling, messageId: message.header.messageId };
  }
}
