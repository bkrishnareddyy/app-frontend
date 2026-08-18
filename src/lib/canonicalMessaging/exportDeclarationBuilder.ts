import type { FilingSnapshotData } from "@/modules/filings/filing.service";
import type { TariffEngineResult } from "@/lib/tariff/dutyEngine";
import {
  mapTransportMode,
  formatIsoDate,
  loadAndMapParty,
  mapProcedurecode,
  mapLineItemToGoodsItem,
  buildInternalData,
  getDefaultCurrency,
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

export async function buildExportDeclaration(params: BuildExportDeclarationParams): Promise<Record<string, any>> {
  const { filingId, shipmentId, snapshotData, tariff, localReferenceNumber, registrationNumber } = params;
  const { shipment, lineItems, documents } = snapshotData;

  const [declarant, exporter, consignee] = await Promise.all([
    loadAndMapParty(shipmentId, "DECLARANT"),
    loadAndMapParty(shipmentId, "EXPORTER"),
    loadAndMapParty(shipmentId, "CONSIGNEE"),
  ]);

  const goodsItems = lineItems.map((item, idx) => {
    const lineResult = tariff.lineResults?.[idx];
    return mapLineItemToGoodsItem(item, lineResult ? {
      customsValue: lineResult.customsValue,
      dutyAmount: lineResult.totalDutyAmount,
    } : undefined);
  });

  const totalInvoiceAmount = lineItems.reduce((sum, item) => sum + item.totalValue, 0);
  const supportingDocuments = documents?.map((doc) => ({
    Type: doc.docType || "999",
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
        Procedure: mapProcedurecode(snapshotData.filingHeader.entryType, (shipment as any).destinationCountry, "export"),
        InvoiceAmount: totalInvoiceAmount,
        InvoiceCurrency: getDefaultCurrency((shipment as any).countryOfExport || undefined),
        GoodsItemQuantity: lineItems.length,
        ExportCountry: (shipment as any).countryOfExport,
        DestinationCountry: (shipment as any).destinationCountry,
        DeclarantStatus: "2",
        Declarant: declarant,
        Exporter: exporter,
        Consignee: consignee,
        GoodsShipment: {
          Consignment: {
            TransportMeans: (shipment as any).transportMode ? { ModeCode: mapTransportMode((shipment as any).transportMode) } : undefined,
            Carrier: shipment.carrierName ? { Name: shipment.carrierName } : undefined,
            DepartureTransportMeans: {
              Location: shipment.portOfEntry ? { Name: shipment.portOfEntry } : undefined,
              DepartureDate: formatIsoDate((shipment as any).ladingDate || (shipment as any).estimatedArrival),
            },
            DeliveryTerms: shipment.incoterm ? { Code: shipment.incoterm } : undefined,
            GoodsItem: goodsItems,
          },
        },
        SupportingDocuments: supportingDocuments.length > 0 ? supportingDocuments : undefined,
        InternalData: buildInternalData(shipmentId, filingId, (shipment as any).status, (shipment as any).currentStage),
        Response: {},
      },
    },
  };
}
