import { db } from "@/lib/db";
import { FactService } from "@/modules/shipment/factService";

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
  facts: Record<string, ShipmentFactContext>;
  lineItems: ShipmentLineItemSummary[];
  documents: ShipmentDocumentSummary[];
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

export async function buildAgentContext(shipmentId: string): Promise<ShipmentAgentContext> {
  const [shipment, factsByField, lineItems, documents] = await Promise.all([
    db.shipment.findUnique({ where: { id: shipmentId }, select: { accountId: true } }),
    FactService.latestByField(shipmentId),
    db.shipmentLineItem.findMany({ where: { shipmentId }, orderBy: { lineNumber: "asc" } }),
    db.shipmentDocument.findMany({ where: { shipmentId }, orderBy: { createdAt: "desc" } }),
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

  return {
    shipmentId,
    accountId: shipment.accountId,
    facts,
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
