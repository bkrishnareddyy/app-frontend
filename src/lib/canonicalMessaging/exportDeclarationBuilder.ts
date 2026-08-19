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

export interface BuildExportDeclarationParams {
  accountId: string;
  filingId: string;
  shipmentId: string;
  snapshotData: FilingSnapshotData;
  tariff: TariffEngineResult;
  localReferenceNumber?: string | null;
  registrationNumber?: string | null;
}

/**
 * Builds a complete Export Declaration following the ExportDeclaration.schema.json structure.
 * Commercial invoice values remain in their original currency; customs-value calculations
 * use the filing's frozen conversion context separately.
 */
export async function buildExportDeclaration(
  params: BuildExportDeclarationParams
): Promise<Record<string, any>> {
  const { filingId, shipmentId, snapshotData, tariff, localReferenceNumber, registrationNumber } = params;
  const { shipment, lineItems, documents, currency } = snapshotData;

  const [declarant, exporter, directConsignee] = await Promise.all([
    loadAndMapParty(shipmentId, "DECLARANT"),
    loadAndMapParty(shipmentId, "EXPORTER"),
    loadAndMapParty(shipmentId, "CONSIGNEE"),
  ]);
  const consignee = directConsignee ?? await loadAndMapParty(shipmentId, "IMPORTER_OF_RECORD");

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
    ExportDeclaration: {
      GoodsDeclaration: {
        ReferenceNumber: localReferenceNumber || filingId,
        EntryNumber: snapshotData.filingHeader.entryNumber,
        DeclarationNumber: shipment.shipmentNumber,
        RegistrationNumber: registrationNumber || undefined,

        AreaCode: "EX",
        FunctionCode: "9",

        Procedure: mapProcedurecode(
          snapshotData.filingHeader.entryType,
          shipment.destinationCountry,
          "export"
        ),

        InvoiceAmount: totalInvoiceAmount,
        InvoiceCurrency: currency.commercialCurrency,
        GoodsItemQuantity: lineItems.length,

        ExportCountry: shipment.countryOfExport,
        DestinationCountry: shipment.destinationCountry,

        DeclarantStatus: "2",
        Declarant: declarant,
        Exporter: exporter,
        Consignee: consignee,

        GoodsShipment: {
          Consignment: {
            TransportMeans: shipment.transportMode ? {
              ModeCode: mapTransportMode(shipment.transportMode),
            } : undefined,
            Carrier: shipment.carrierName ? {
              Name: shipment.carrierName,
            } : undefined,
            DepartureTransportMeans: {
              Location: shipment.portOfEntry ? {
                Name: shipment.portOfEntry,
              } : undefined,
              DepartureDate: formatIsoDate(shipment.ladingDate || shipment.estimatedArrival),
            },
            DeliveryTerms: shipment.incoterm ? {
              Code: shipment.incoterm,
            } : undefined,
            GoodsItem: goodsItems,
          },
        },

        SupportingDocuments: supportingDocuments.length > 0 ? supportingDocuments : undefined,

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
