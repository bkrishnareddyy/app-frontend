import { db } from "@/lib/db";
import type { FilingSnapshotData } from "@/modules/filings/filing.service";
import type { TariffEngineResult } from "@/lib/tariff/dutyEngine";
import type { CanonicalCustomsDeclaration, CanonicalParty } from "./types";

/** Splits a stored HTS code into the universal HS6 prefix and the national tail beyond it. */
function splitHsCode(htsCode: string): { hsCode6: string; nationalTariffSuffix?: string } {
  const digits = htsCode.replace(/\D/g, "");
  const hsCode6 = digits.slice(0, 6).padEnd(6, "0");
  const rest = digits.slice(6);
  return rest.length > 0 ? { hsCode6, nationalTariffSuffix: rest } : { hsCode6 };
}

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

export interface BuildDeclarationParams {
  accountId: string;
  filingId: string;
  shipmentId: string;
  snapshotData: FilingSnapshotData;
  tariff: TariffEngineResult;
}

/**
 * Builds the country-agnostic canonical declaration. Reads only from data
 * already resolved by the time transmitFiling() calls this -- the frozen
 * FilingSnapshotData and the tariff calculation -- never from raw/unverified
 * extraction. Classification stays at HS6 plus a national-suffix field the
 * third party fills in per destination; Qubere's own classification is
 * US-HTSUS-specific and is not valid for an arbitrary destination country.
 */
export async function buildCanonicalDeclaration(params: BuildDeclarationParams): Promise<CanonicalCustomsDeclaration> {
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
