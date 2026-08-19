import type { FilingSnapshotData } from "@/modules/filings/filing.service";
import type { TariffEngineResult } from "@/lib/tariff/dutyEngine";
import {
  mapTransportMode,
  formatIsoDate,
  loadAndMapParty,
  mapProcedurecode,
  mapLineItemToGoodsItem,
  mapDocumentType,
  buildInternalData,
} from "./fieldMappers";

export interface BuildImportDeclarationParams {
  accountId: string;
  filingId: string;
  shipmentId: string;
  snapshotData: FilingSnapshotData;
  tariff: TariffEngineResult;
  localReferenceNumber?: string | null;
  registrationNumber?: string | null;
}

/**
 * Builds a complete Import Declaration following the ImportDeclaration.schema.json structure.
 * Commercial invoice values remain in their original currency; the tariff result carries
 * the converted customs-value amounts used for duty calculation.
 */
export async function buildImportDeclaration(
  params: BuildImportDeclarationParams
): Promise<Record<string, any>> {
  const { filingId, shipmentId, snapshotData, tariff, localReferenceNumber, registrationNumber } = params;
  const { shipment, lineItems, documents, currency } = snapshotData;

  const [declarant, importer, exporter] = await Promise.all([
    loadAndMapParty(shipmentId, "DECLARANT"),
    loadAndMapParty(shipmentId, "IMPORTER_OF_RECORD"),
    loadAndMapParty(shipmentId, "EXPORTER"),
  ]);

  const goodsItems = lineItems.map((item, idx) => {
    const lineResult = tariff.lineResults?.[idx];
    return mapLineItemToGoodsItem(item, lineResult ? {
      customsValue: lineResult.customsValue,
      dutyAmount: lineResult.totalDutyAmount,
    } : undefined);
  });

  const totalInvoiceAmount = lineItems.reduce((sum, item) => sum + item.totalValue, 0);

  const supportingDocuments = documents?.map(doc => ({
    Type: mapDocumentType(doc.docType),
    ReferenceNumber: doc.id,
    Name: doc.fileName,
  })) || [];

  return {
    ImportDeclaration: {
      GoodsDeclaration: {
        ReferenceNumber: localReferenceNumber || filingId,
        EntryNumber: snapshotData.filingHeader.entryNumber,
        DeclarationNumber: shipment.shipmentNumber,
        RegistrationNumber: registrationNumber || undefined,

        FunctionCode: "9",
        KindOfDeclaration: "IM",
        MessageRole: "EDI",

        Procedure: mapProcedurecode(
          snapshotData.filingHeader.entryType,
          shipment.destinationCountry,
          "import"
        ),

        InvoiceAmount: totalInvoiceAmount,
        InvoiceCurrency: currency.commercialCurrency,
        GoodsItemQuantity: lineItems.length,

        DeclarantStatus: "2",
        Declarant: declarant,
        Importer: importer,
        Exporter: exporter,

        GoodsShipment: {
          Consignment: {
            TransportMeans: shipment.transportMode ? {
              ModeCode: mapTransportMode(shipment.transportMode),
            } : undefined,
            Carrier: shipment.carrierName ? {
              Name: shipment.carrierName,
            } : undefined,
            ArrivalTransportMeans: {
              LocationOfGoods: shipment.portOfEntry ? {
                Name: shipment.portOfEntry,
              } : undefined,
              ArrivalDate: formatIsoDate(shipment.arrivalDate || shipment.estimatedArrival),
            },
            DeliveryTerms: shipment.incoterm ? {
              Code: shipment.incoterm,
            } : undefined,
            GoodsItem: goodsItems,
          },
        },

        SupportingDocuments: supportingDocuments.length > 0 ? supportingDocuments : undefined,

        ValuationAdjustment: {
          AdditionCode: "1",
        },

        InternalData: buildInternalData(
          shipmentId,
          filingId,
          shipment.status,
          shipment.currentStage ?? undefined
        ),

        Response: {},
      },
    },
  };
}
