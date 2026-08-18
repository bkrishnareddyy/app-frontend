import { db } from "@/lib/db";
import type { FilingSnapshotData } from "@/modules/filings/filing.service";
import type { TariffEngineResult } from "@/lib/tariff/dutyEngine";
import type { CanonicalCustomsDeclaration, CanonicalParty, DeclarationData } from "./types";
import { buildImportDeclaration, type BuildImportDeclarationParams } from "./importDeclarationBuilder";
import { buildExportDeclaration, type BuildExportDeclarationParams } from "./exportDeclarationBuilder";
import { splitHsCode } from "./fieldMappers";

/** @deprecated Use loadAndMapParty from fieldMappers instead */
async function loadParty(accountId: string, shipmentId: string, role: string): Promise<CanonicalParty | undefined> {
  const party = await db.shipmentParty.findFirst({
    where: { shipmentId, role },
    include: { legalEntity: true },
  });
  if (!party) return undefined;
  return {
    name: party.legalEntity.legalName,
    country: party.legalEntity.country,
    taxId: party.legalEntity.taxIdentifier ?? undefined,
  };
}

/**
 * Wraps declaration data in the correct schema structure based on transaction type.
 * 
 * If data is already wrapped (has ImportDeclaration or ExportDeclaration), returns as-is.
 * Otherwise, wraps GoodsDeclaration in the appropriate top-level structure.
 */
export function wrapDeclarationData(data: any, transactionType: string): DeclarationData {
  // Already wrapped - return as-is
  if (data.ImportDeclaration || data.ExportDeclaration) {
    return data;
  }

  // Determine wrapper based on transaction type
  const isImport = transactionType.toUpperCase().includes("IMPORT") || transactionType === "H1";
  const wrapperKey = isImport ? "ImportDeclaration" : "ExportDeclaration";

  // If data has GoodsDeclaration at top level, wrap it
  if (data.GoodsDeclaration) {
    return {
      [wrapperKey]: data
    };
  }

  // Otherwise, assume the entire data object is the GoodsDeclaration content
  return {
    [wrapperKey]: {
      GoodsDeclaration: data
    }
  };
}

export interface BuildDeclarationParams {
  accountId: string;
  filingId: string;
  shipmentId: string;
  snapshotData: FilingSnapshotData;
  tariff: TariffEngineResult;
  /** Transaction type: "import" or "export" - determines which schema to use */
  transactionType?: "import" | "export";
  localReferenceNumber?: string | null;
  registrationNumber?: string | null;
}

/**
 * Builds a transaction-specific declaration (Import or Export) with comprehensive field mapping.
 * 
 * Routes to the appropriate builder based on transactionType:
 * - "import" → ImportDeclaration with full Import schema structure
 * - "export" → ExportDeclaration with full Export schema structure
 * - undefined → Legacy CanonicalCustomsDeclaration (backwards compatibility)
 * 
 * The new builders map ALL available Shipment fields to their canonical schema equivalents,
 * including parties, transport, line items, documents, and internal tracking data.
 */
export async function buildCanonicalDeclaration(
  params: BuildDeclarationParams
): Promise<DeclarationData> {
  const { transactionType } = params;

  // Route to transaction-specific builder
  if (transactionType === "import") {
    return await buildImportDeclaration(params as BuildImportDeclarationParams);
  } else if (transactionType === "export") {
    return await buildExportDeclaration(params as BuildExportDeclarationParams);
  }

  // Legacy path: Build the old CanonicalCustomsDeclaration format
  // This maintains backwards compatibility with existing code
  return await buildLegacyDeclaration(params);
}

/**
 * Legacy declaration builder - maintains backwards compatibility.
 * 
 * @deprecated Use buildImportDeclaration or buildExportDeclaration instead.
 * This function builds the old ~20-field format and will be removed once all
 * callers are updated to use transaction-specific builders.
 */
async function buildLegacyDeclaration(params: BuildDeclarationParams): Promise<CanonicalCustomsDeclaration> {
  const { accountId, shipmentId, snapshotData, tariff } = params;

  const [importer, exporter] = await Promise.all([
    loadParty(accountId, shipmentId, "IMPORTER_OF_RECORD"),
    loadParty(accountId, shipmentId, "EXPORTER"),
  ]);

  const lineItems = snapshotData.lineItems.map((item) => {
    const { hsCode6, nationalTariffSuffix } = splitHsCode(item.htsCode);
    return {
      lineNumber: item.lineNumber,
      description: item.description,
      hsCode6,
      nationalTariffSuffix,
      originCountry: item.countryOfOrigin,
      quantity: { value: item.quantity, uom: "PCS" },
      unitPrice: item.unitPrice,
      totalValue: item.totalValue,
    };
  });

  return {
    declarationId: params.filingId,
    entryType: snapshotData.filingHeader.entryType,
    importer,
    exporter,
    transport: {
      carrierName: snapshotData.shipment.carrierName ?? undefined,
      portOfEntry: snapshotData.shipment.portOfEntry ?? undefined,
    },
    incoterm: snapshotData.shipment.incoterm ?? undefined,
    lineItems,
    valuation: {
      method: "Transaction Value (Method 1)",
      totalValue: tariff.totalCustomsValue,
    },
    totals: {
      customsValue: tariff.totalCustomsValue,
      dutyAmount: tariff.totalDuty,
      feesAmount: tariff.totalFees,
    },
    evidence: {
      sourceDocumentIds: snapshotData.documents.map((d) => d.id),
    },
  };
}
