import { db } from "@/lib/db";
import { FactService } from "@/modules/shipment/factService";
import type { EmbargoParty } from "@/modules/agents/compliance/embargo/types";

/**
 * ShipmentPartyRole values treated as the transaction's SHIP_TO party for
 * Country Embargo Screening (CountryEmbargoScreening_Prompt.md section 15).
 * Qubere's ShipmentPartyRole vocabulary (shipmentPartyService.ts) has no
 * literal "SHIP_TO" value and no existing codebase convention maps one --
 * DELIVERY_TO is the closest literal match, with CONSIGNEE/ULTIMATE_CONSIGNEE
 * as the closest customs-semantic fallbacks. This is a data-mapping
 * assumption to bridge naming, not an invented business rule; it does not
 * decide any embargo outcome by itself.
 */
const SHIP_TO_ROLES = new Set(["DELIVERY_TO", "ULTIMATE_CONSIGNEE", "CONSIGNEE"]);

export interface ShipmentFactContext {
  value: string;
  sourceType: string;
  confidence: number | null;
  documentId: string | null;
  createdAt: string;
}

export interface ShipmentLineItemSummary {
  lineNumber: number;
  description: string;
  partNumber: string | null;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  countryOfOrigin: string;
  htsCode: string;
  htsConfidence: number | null;
  eccnCode: string | null;
  status: string;
}

export interface ShipmentDocumentSummary {
  id: string;
  docType: string;
  fileName: string;
  /** ShipmentDocument.extractedJson's `tradeMetadata` object -- exporter, importer, incoterm, currency, PO/invoice numbers, ports, carrier, etc. Null until the document has been through Document Intelligence. */
  tradeMetadata: Record<string, unknown> | null;
}

/**
 * Everything known about a shipment right now, assembled fresh from Postgres:
 * the latest discovered value per field (Fact, across every document and
 * every agent that ever ran), the current curated line items, and every
 * document's extracted trade metadata.
 *
 * This is the one input every agent invocation is built from -- replacing
 * the narrow, hand-picked DTOs each pipeline step used to construct from only
 * the immediately-preceding agent's output. It is also captured verbatim as
 * the execution log row's inputSnapshot, so "what did this agent actually
 * see" is answered by reading a row instead of re-deriving it from code.
 */
export interface ShipmentAgentContext {
  shipmentId: string;
  accountId: string;
  /** Shipment.countryOfExport -- the Country Embargo Screening compliance/ship-from country. */
  countryOfExport: string | null;
  facts: Record<string, ShipmentFactContext>;
  lineItems: ShipmentLineItemSummary[];
  documents: ShipmentDocumentSummary[];
  /**
   * Transaction parties for Country Embargo Screening, sourced from
   * ShipmentParty -> LegalEntity (the party/country linkage actually used
   * elsewhere in the codebase) and, where LegalEntity.partyId backfills to
   * the Global Party Master, cross-referenced against Party/PartyAddress.
   * militaryEndUse is always undefined: no such field exists anywhere in the
   * schema (CountryEmbargoScreening_Prompt.md section 18 -- "do not fabricate
   * it"). See SHIP_TO_ROLES for the isShipTo mapping assumption.
   */
  parties: EmbargoParty[];
}

function parseTradeMetadata(extractedJson: string | null): Record<string, unknown> | null {
  if (!extractedJson) return null;
  try {
    const parsed = JSON.parse(extractedJson) as { tradeMetadata?: Record<string, unknown> };
    return parsed?.tradeMetadata ?? null;
  } catch {
    return null;
  }
}

export async function buildAgentContext(shipmentId: string, accountId: string): Promise<ShipmentAgentContext> {
  const [shipment, factsByField, lineItems, documents, shipmentParties] = await Promise.all([
    db.shipment.findFirst({ where: { id: shipmentId, accountId }, select: { accountId: true, countryOfExport: true } }),
    FactService.latestByField(shipmentId),
    db.shipmentLineItem.findMany({ where: { shipmentId }, orderBy: { lineNumber: "asc" } }),
    db.shipmentDocument.findMany({ where: { shipmentId }, orderBy: { createdAt: "desc" } }),
    db.shipmentParty.findMany({
      where: { shipmentId },
      include: {
        legalEntity: {
          include: {
            party: { include: { addresses: true } },
          },
        },
      },
    }),
  ]);

  if (!shipment) {
    throw new Error(`Shipment ${shipmentId} not found`);
  }

  const facts: ShipmentAgentContext["facts"] = {};
  for (const [field, fact] of factsByField) {
    facts[field] = {
      value: fact.value,
      sourceType: fact.sourceType,
      confidence: fact.confidence,
      documentId: fact.documentId,
      createdAt: fact.createdAt.toISOString(),
    };
  }

  const parties: EmbargoParty[] = shipmentParties.map((sp) => {
    const legalEntity = sp.legalEntity;
    const primaryAddress =
      legalEntity.party?.addresses.find((a) => a.isPrimary) ?? legalEntity.party?.addresses[0] ?? null;
    return {
      partyId: legalEntity.id,
      partyType: sp.role,
      country: legalEntity.country ?? primaryAddress?.country ?? null,
      userDefined: legalEntity.legalName,
      // No military-end-use field exists in the schema (Party, PartyAddress,
      // or LegalEntity) -- left undefined rather than fabricated.
      militaryEndUse: undefined,
      isShipTo: SHIP_TO_ROLES.has(sp.role.toUpperCase()),
    };
  });

  return {
    shipmentId,
    accountId: shipment.accountId,
    countryOfExport: shipment.countryOfExport,
    facts,
    parties,
    lineItems: lineItems.map((li) => ({
      lineNumber: li.lineNumber,
      description: li.description,
      partNumber: li.partNumber,
      quantity: li.quantity,
      unitPrice: li.unitPrice.toNumber(),
      totalValue: li.totalValue.toNumber(),
      countryOfOrigin: li.countryOfOrigin,
      htsCode: li.htsCode,
      htsConfidence: li.htsConfidence,
      eccnCode: li.eccnCode,
      status: li.status,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      tradeMetadata: parseTradeMetadata(d.extractedJson),
    })),
  };
}

/** Convenience accessor: the current value of a shipment-level fact (not line-item-scoped), or null if never discovered. */
export function factValue(context: ShipmentAgentContext, field: string): string | null {
  return context.facts[field]?.value ?? null;
}

/** The most recently extracted document's trade metadata, or null if none extracted yet. */
export function latestTradeMetadata(context: ShipmentAgentContext): Record<string, unknown> | null {
  return context.documents.find((d) => d.tradeMetadata)?.tradeMetadata ?? null;
}
