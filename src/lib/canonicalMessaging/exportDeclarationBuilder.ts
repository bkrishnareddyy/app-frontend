import { db } from "@/lib/db";
import type { FilingSnapshotData } from "@/modules/filings/filing.service";
import type { TariffEngineResult } from "@/lib/tariff/dutyEngine";
import {
  splitHsCode,
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

/**
 * Builds a complete Export Declaration following the ExportDeclaration.schema.json structure.
 * Maps all available Shipment fields to their canonical schema equivalents.
 */
export async function buildExportDeclaration(
  params: BuildExportDeclarationParams
): Promise<Record<string, any>> {
  const { accountId, filingId, shipmentId, snapshotData, tariff, localReferenceNumber, registrationNumber } = params;
  const { shipment, lineItems, documents } = snapshotData;

  // Load parties (different roles for export)
  const [declarant, exporter, consignee] = await Promise.all([
    loadAndMapParty(shipmentId, "DECLARANT"),
    loadAndMapParty(shipmentId, "EXPORTER"),
    loadAndMapParty(shipmentId, "CONSIGNEE") || loadAndMapParty(shipmentId, "IMPORTER_OF_RECORD"), // Fallback
  ]);

  // Map line items with tariff results
  const goodsItems = lineItems.map((item, idx) => {
    const lineResult = tariff.lineResults?.[idx];
    return mapLineItemToGoodsItem(item, lineResult ? {
      customsValue: lineResult.customsValue,
      dutyAmount: lineResult.dutyAmount,
    } : undefined);
  });

  // Calculate totals
  const totalInvoiceAmount = lineItems.reduce((sum, item) => sum + item.totalValue, 0);

  // Map documents
  const supportingDocuments = documents?.map(doc => ({
    Type: doc.documentType || "999",
    ReferenceNumber: doc.documentNumber || doc.id,
    Date: formatIsoDate(doc.documentDate),
    Name: doc.fileName,
  })) || [];

  // Build the ExportDeclaration
  return {
    ExportDeclaration: {
      GoodsDeclaration: {
        // Reference Numbers
        ReferenceNumber: localReferenceNumber || filingId,  // User-provided local reference or filing ID
        EntryNumber: snapshotData.filingHeader.entryNumber,  // Customs entry number
        DeclarationNumber: shipment.shipmentNumber,
        RegistrationNumber: registrationNumber || undefined,  // User-provided registration number

        // Area Code (Export-specific)
        AreaCode: "EX",              // EX = Export

        // Function & Message Control
        FunctionCode: "9",           // 9 = Original declaration

        // Procedure
        Procedure: mapProcedurecode(
          snapshotData.filingHeader.entryType,
          shipment.destinationCountry,
          "export"
        ),

        // Financial Summary
        InvoiceAmount: totalInvoiceAmount,
        InvoiceCurrency: getDefaultCurrency(shipment.countryOfExport || undefined),
        GoodsItemQuantity: lineItems.length,

        // Export Country
        ExportCountry: shipment.countryOfExport,
        
        // Destination Country
        DestinationCountry: shipment.destinationCountry,

        // Declarant (person/company filing)
        DeclarantStatus: "2",        // 2 = Representative
        Declarant: declarant,

        // Parties - Exporter
        Exporter: exporter,

        // Parties - Consignee (foreign buyer)
        Consignee: consignee,

        // Goods Shipment - Main Container
        GoodsShipment: {
          Consignment: {
            // Transport Means
            TransportMeans: shipment.transportMode ? {
              ModeCode: mapTransportMode(shipment.transportMode),
            } : undefined,

            // Carrier Information
            Carrier: shipment.carrierName ? {
              Name: shipment.carrierName,
            } : undefined,

            // Departure Details (Exit port for exports)
            DepartureTransportMeans: {
              Location: shipment.portOfEntry ? {  // Using portOfEntry field for exit port
                Name: shipment.portOfEntry,
              } : undefined,
              DepartureDate: formatIsoDate(shipment.ladingDate || shipment.estimatedArrival),
            },

            // Delivery Terms (Incoterm)
            DeliveryTerms: shipment.incoterm ? {
              Code: shipment.incoterm,
            } : undefined,

            // Line Items (Goods Items)
            GoodsItem: goodsItems,
          },
        },

        // Supporting Documents
        SupportingDocuments: supportingDocuments.length > 0 ? supportingDocuments : undefined,

        // Internal Data (Qubere-specific tracking)
        InternalData: buildInternalData(
          shipmentId,
          filingId,
          shipment.status,
          shipment.currentStage
        ),

        // Response Section (empty for outbound request)
        Response: {},
      },
    },
  };
}
