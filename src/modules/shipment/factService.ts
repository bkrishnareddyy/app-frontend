import { db } from "@/lib/db";
import { Prisma, Fact } from "@prisma/client";

/**
 * EXTRACTED: read off a document by an extraction agent (Document Intelligence).
 * AGENT_PROPOSED: derived/enriched by a downstream agent (Product Intelligence,
 * HTS Classification, Origin Rules, Valuation) rather than read directly off a document.
 * USER_ENTERED: a human set or corrected this value -- always authoritative.
 */
export type FactSourceType = "EXTRACTED" | "AGENT_PROPOSED" | "USER_ENTERED";

export interface RecordFactInput {
  shipmentId: string;
  field: string;
  value: string;
  normalizedValue?: string | null;
  sourceType: FactSourceType;
  confidence?: number | null;
  documentId?: string | null;
  documentPage?: number | null;
  metadata?: Prisma.InputJsonValue | null;
}

/**
 * Fact is the shipment's append-only context object: every value any agent or
 * user ever discovered or entered, tagged with where it came from. Rows are
 * never updated or deleted -- a later discovery is a new row, not a
 * replacement, so nothing an earlier document or agent found is ever lost.
 *
 * This is deliberately separate from the curated record (Shipment /
 * ShipmentLineItem): Fact answers "what has ever been discovered," the
 * curated record answers "what do we file." See lineItemReconciler.ts for
 * the rule that governs how (and whether) a Fact reaches the curated record.
 */
export class FactService {
  static async record(input: RecordFactInput): Promise<Fact> {
    return db.fact.create({
      data: {
        shipmentId: input.shipmentId,
        field: input.field,
        value: input.value,
        normalizedValue: input.normalizedValue ?? null,
        sourceType: input.sourceType,
        confidence: input.confidence ?? null,
        documentId: input.documentId ?? null,
        documentPage: input.documentPage ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  static async recordMany(inputs: RecordFactInput[]): Promise<{ count: number }> {
    if (inputs.length === 0) return { count: 0 };
    return db.fact.createMany({
      data: inputs.map((input) => ({
        shipmentId: input.shipmentId,
        field: input.field,
        value: input.value,
        normalizedValue: input.normalizedValue ?? null,
        sourceType: input.sourceType,
        confidence: input.confidence ?? null,
        documentId: input.documentId ?? null,
        documentPage: input.documentPage ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      })),
    });
  }

  /**
   * The most recently recorded fact for each field on this shipment, across
   * every document and every agent that has ever run. This -- not any single
   * agent's output -- is "the fullest possible context" an agent should read
   * before it runs. See agentContext.ts.
   */
  static async latestByField(shipmentId: string): Promise<Map<string, Fact>> {
    const facts = await db.fact.findMany({
      where: { shipmentId },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<string, Fact>();
    for (const fact of facts) {
      if (!latest.has(fact.field)) latest.set(fact.field, fact);
    }
    return latest;
  }

  /** Every fact ever recorded for one field, most recent first -- the field's full discovery history. */
  static async history(shipmentId: string, field: string): Promise<Fact[]> {
    return db.fact.findMany({
      where: { shipmentId, field },
      orderBy: { createdAt: "desc" },
    });
  }
}
