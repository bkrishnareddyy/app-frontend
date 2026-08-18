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
 * Maps all available Shipment fields to their canonical schema equivalents.
 */
export async function buildImportDeclaration(
  params: BuildImportDeclarationParams
): Promise<Record<string, any>> {
  const { accountId, filingId, shipmentId, snapshotData, tariff, localReferenceNumber, registrationNumber } = params;
  const { shipment, lineItems, documents } = snapshotData;

  // Load parties
  const [declarant, importer, exporter] = await Promise.all([
    loadAndMapParty(shipmentId, "DECLARANT"),
    loadAndMapParty(shipmentId, "IMPORTER_OF_RECORD"),
    loadAndMapParty(shipmentId, "EXPORTER"),
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

  // Build the ImportDeclaration
  return {
    ImportDeclaration: {
      GoodsDeclaration: {
        // Reference Numbers
        ReferenceNumber: localReferenceNumber || filingId,  // User-provided local reference or filing ID
        EntryNumber: snapshotData.filingHeader.entryNumber,  // Customs entry number
        DeclarationNumber: shipment.shipmentNumber,
        RegistrationNumber: registrationNumber || undefined,  // User-provided registration number

        // Function & Message Control
        FunctionCode: "9",           // 9 = Original declaration
        KindOfDeclaration: "IM",     // IM = Import
        MessageRole: "EDI",          // EDI = Electronic data interchange

        // Procedure
        Procedure: mapProcedurecode(
          snapshotData.filingHeader.entryType,
          (shipment as any).destinationCountry,
          "import"
        ),
        // SubProcedure: undefined,  // Country-specific, configured per procedure

        // Financial Summary
        InvoiceAmount: totalInvoiceAmount,
        InvoiceCurrency: getDefaultCurrency((shipment as any).destinationCountry || undefined),
        GoodsItemQuantity: lineItems.length,

        // Declarant (person/company filing)
        DeclarantStatus: "2",        // 2 = Representative
        Declarant: declarant,

        // Parties - Importer
        Importer: importer,

        // Parties - Exporter
        Exporter: exporter,

        // Goods Shipment - Main Container
        GoodsShipment: {
          Consignment: {
            // Transport Means
            TransportMeans: (shipment as any).transportMode ? {
              ModeCode: mapTransportMode((shipment as any).transportMode),
            } : undefined,

            // Carrier Information
            Carrier: shipment.carrierName ? {
              Name: shipment.carrierName,
            } : undefined,

            // Arrival Details
            ArrivalTransportMeans: {
              LocationOfGoods: shipment.portOfEntry ? {
                Name: shipment.portOfEntry,
              } : undefined,
              ArrivalDate: formatIsoDate((shipment as any).arrivalDate || (shipment as any).estimatedArrival),
            },

            // Delivery Terms (Incoterm)
            DeliveryTerms: shipment.incoterm ? {
              Code: shipment.incoterm,
            } : undefined,

            // Container Indicator
            // ContainerIndicator: false,  // TODO: Add if container info available

            // Line Items (Goods Items)
            GoodsItem: goodsItems,
          },
        },

        // Supporting Documents
        SupportingDocuments: supportingDocuments.length > 0 ? supportingDocuments : undefined,

        // Valuation Summary
        ValuationAdjustment: {
          AdditionCode: "1",  // Transaction value method
        },

        // Internal Data (Qubere-specific tracking)
        InternalData: buildInternalData(
          shipmentId,
          filingId,
          (shipment as any).status,
          (shipment as any).currentStage
        ),

        // Response Section (empty for outbound request)
        Response: {},
      },
    },
  };
}
