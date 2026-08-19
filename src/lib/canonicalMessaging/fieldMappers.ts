import { db } from "@/lib/db";
import type { FilingSnapshotData } from "@/modules/filings/filing.service";

/**
 * Shared field mapping utilities for declaration builders.
 * These functions transform Shipment/ShipmentLineItem data into canonical schema formats.
 */

/** Splits a stored HTS code into the universal HS6 prefix and the national tail beyond it. */
export function splitHsCode(htsCode: string): { hsCode6: string; nationalTariffSuffix?: string } {
  const digits = htsCode.replace(/\D/g, "");
  const hsCode6 = digits.slice(0, 6).padEnd(6, "0");
  const rest = digits.slice(6);
  return rest.length > 0 ? { hsCode6, nationalTariffSuffix: rest } : { hsCode6 };
}

/**
 * Maps transport mode to UN/CEFACT code
 * 1 = Maritime, 2 = Rail, 3 = Road, 4 = Air, 5 = Mail, 8 = Inland waterway
 */
export function mapTransportMode(mode: string | null | undefined): string {
  const modeMap: Record<string, string> = {
    "Ocean": "1",
    "Maritime": "1",
    "Rail": "2",
    "Truck": "3",
    "Road": "3",
    "Air": "4",
    "Mail": "5",
    "Inland Waterway": "8"
  };
  return modeMap[mode || ""] || "1"; // Default to maritime
}

/**
 * Format date to ISO 8601 string (YYYY-MM-DDTHH:mm:ssZ)
 */
export function formatIsoDate(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;
  if (typeof date === 'string') return date;
  return date.toISOString();
}

/**
 * Load and map a party from ShipmentParty table
 */
export async function loadAndMapParty(
  shipmentId: string,
  role: string
): Promise<{
  Name?: string;
  Address?: {
    Street?: string;
    City?: string;
    PostCode?: string;
    Country?: string;
  };
  EORI?: string;
  TIN?: string;
  Communication?: {
    Email?: string;
    Phone?: string;
  };
} | undefined> {
  const party = await db.shipmentParty.findFirst({
    where: { shipmentId, role },
    include: { legalEntity: true },
  });

  if (!party || !party.legalEntity) return undefined;

  const entity = party.legalEntity;
  
  return {
    Name: entity.legalName || undefined,
    Address: {
      Street: (entity as any).address || undefined,
      City: entity.city || undefined,
      PostCode: entity.postalCode || undefined,
      Country: entity.country || undefined,
    },
    EORI: (entity as any).eoriNumber || undefined,
    TIN: entity.taxIdentifier || undefined,
    Communication: {
      Email: (entity as any).email || undefined,
      Phone: (entity as any).phone || undefined,
    },
  };
}

/**
 * Map entry type to country-specific procedure code
 * This is a simplified mapping - real implementation would use FilingProcedureConfig
 */
export function mapProcedurecode(
  entryType: string | null | undefined,
  country: string | null | undefined,
  transactionType: "import" | "export"
): string {
  // Default procedure codes
  if (transactionType === "import") {
    // Common import procedures
    const importMap: Record<string, string> = {
      "01": "40",  // Consumption entry
      "03": "40",  // Consumption warehouse
      "06": "51",  // Foreign trade zone
      "11": "40",  // Warehouse entry
    };
    return importMap[entryType || ""] || "40";
  } else {
    // Common export procedures
    return "10"; // Standard export
  }
}

/**
 * Map document type to standard code
 */
export function mapDocumentType(documentType: string): string {
  const typeMap: Record<string, string> = {
    "COMMERCIAL_INVOICE": "380",
    "PACKING_LIST": "271",
    "BILL_OF_LADING": "705",
    "AIR_WAYBILL": "740",
    "CERTIFICATE_OF_ORIGIN": "861",
    "PHYTOSANITARY_CERTIFICATE": "851",
    "FUMIGATION_CERTIFICATE": "852",
  };
  return typeMap[documentType] || "999"; // 999 = Other
}

/**
 * Calculate unit price from total value and quantity
 */
export function calculateUnitPrice(totalValue: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return Math.round((totalValue / quantity) * 100) / 100; // Round to 2 decimals
}

/**
 * Get default currency (can be overridden per shipment/country)
 */
export function getDefaultCurrency(countryCode?: string): string {
  // Country-specific defaults
  const currencyMap: Record<string, string> = {
    "US": "USD",
    "GB": "GBP",
    "EU": "EUR",
    "JP": "JPY",
    "CN": "CNY",
    "IN": "INR",
  };
  return currencyMap[countryCode || ""] || "USD";
}

/**
 * Map shipment line item to GoodsItem schema
 */
export function mapLineItemToGoodsItem(
  lineItem: FilingSnapshotData["lineItems"][number],
  tariffResult?: { customsValue: number; dutyAmount: number }
) {
  const { hsCode6, nationalTariffSuffix } = splitHsCode(lineItem.htsCode);

  return {
    SequenceNumber: lineItem.lineNumber,
    Description: lineItem.description,
    Commodity: {
      CommodityCode: hsCode6,
      NationalTariffSuffix: nationalTariffSuffix,
    },
    GoodsMeasure: {
      GrossMass: lineItem.quantity,
      NetNetWeight: lineItem.quantity, // Assume net = gross if not specified
      UnitOfMeasure: "KGM", // Default to kilograms
    },
    InvoiceLineValue: lineItem.totalValue,
    StatisticalValue: lineItem.totalValue,
    Origin: {
      CountryOfOrigin: lineItem.countryOfOrigin,
    },
    CustomsValuation: tariffResult ? {
      ChargeableAmount: tariffResult.customsValue,
      MethodCode: "1", // Transaction value (WTO Method 1)
    } : undefined,
  };
}

/**
 * Build internal data section for tracking
 */
export function buildInternalData(
  shipmentId: string,
  filingId: string,
  shipmentStatus?: string,
  workflowStage?: string
) {
  return {
    QubereShipmentId: shipmentId,
    QubereFilingId: filingId,
    QubereShipmentStatus: shipmentStatus,
    QubereWorkflowStage: workflowStage,
    QubereTimestamp: new Date().toISOString(),
  };
}
