import { db } from "@/lib/db";
import { Prisma, ShipmentLineItem } from "@prisma/client";
import { FactService, FactSourceType, RecordFactInput } from "./factService";
import { loadHtsCodesMap, calculateDutyStack } from "@/lib/tariff/dutyEngine";

/**
 * Placeholder values LineItemReconciler writes itself when extraction didn't
 * produce a real one, so a required DB column is never left genuinely blank.
 * Exported so reconciliationEngine.ts can detect "this field is still a
 * placeholder" from current DB state without re-deriving the same constants.
 *
 * quantity/unitPrice have no value that's unambiguously "unset" (1 and 0 are
 * both plausible real data) -- the tradeoff is accepted deliberately: a
 * genuinely-quantity-1 or genuinely-free line item may be treated as
 * still-fillable by a later agent run until a human confirms it, same as an
 * actually-missing one. Once a user reviews the row (status -> "Valid"),
 * every field is locked regardless.
 */
export const LINE_ITEM_SENTINELS = {
  htsCode: "UNCLASSIFIABLE",
  countryOfOrigin: "Unknown",
  description: "Unspecified Item",
  quantity: 1,
  unitPrice: 0,
} as const;

/**
 * Whether a stored field is a placeholder rather than something a source read.
 *
 * Two of these sentinels are in-band: the placeholder quantity is 1 and the
 * placeholder unit price is 0, both of which are perfectly ordinary declared
 * values. So the stored value can only ever say "this *might* be a placeholder",
 * and the answer comes from whether a Fact was recorded for the field --
 * recordFacts writes one only when a value was actually present.
 *
 * Reading the value alone reported 20 of a 68-line invoice as having no quantity
 * when every line was read correctly; they simply shipped one unit each.
 *
 * `extracted` is false for rows predating fact recording, which leaves them
 * classified exactly as the value-only rule classified them.
 */
export function isPlaceholderValue(
  field: "quantity" | "unitPrice" | "countryOfOrigin",
  value: number | string | { toString(): string },
  extracted: boolean
): boolean {
  if (extracted) return false;
  if (field === "countryOfOrigin") return String(value) === LINE_ITEM_SENTINELS.countryOfOrigin;
  return Number(value) === LINE_ITEM_SENTINELS[field];
}

export interface LineItemDiscovery {
  lineNumber: number;
  description?: string | null;
  partNumber?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalValue?: number | null;
  countryOfOrigin?: string | null;
  htsCode?: string | null;
  htsConfidence?: number | null;
  eccnCode?: string | null;
}

export interface ApplyDiscoveriesInput {
  shipmentId: string;
  accountId: string;
  documentId?: string | null;
  sourceType: Extract<FactSourceType, "EXTRACTED" | "AGENT_PROPOSED">;
  items: LineItemDiscovery[];
}

/** Fact field naming for line-item-scoped discoveries -- exported so callers recording related facts (e.g. enrichment detail with no ShipmentLineItem column) use the same key shape. */
export function lineItemFactField(lineNumber: number, field: string): string {
  return `lineItem.${lineNumber}.${field}`;
}

/**
 * The write-authority boundary between agents and the curated record.
 *
 * Every discovery is recorded to Fact unconditionally (§ context object,
 * never discarded). Whether it also reaches ShipmentLineItem depends on
 * whether the field is still empty:
 *  - empty (row doesn't exist yet, or holds one of LINE_ITEM_SENTINELS) ->
 *    an agent may fill it directly. This is "adding," not an edit: no
 *    Shipment.version bump, no ShipmentChangeEvent.
 *  - already holds a real value -> an agent's output never overwrites it,
 *    no matter how it disagrees. It's still captured in Fact; only a user
 *    edit (see decisions/route.ts, shipments/[id]/route.ts) changes an
 *    already-set field, and that path is what versions the shipment.
 */
export class LineItemReconciler {
  static async applyDiscoveries(input: ApplyDiscoveriesInput): Promise<void> {
    for (const item of input.items) {
      await this.applyOne(input, item);
    }
  }

  private static async recordFacts(ctx: ApplyDiscoveriesInput, item: LineItemDiscovery): Promise<void> {
    const facts: RecordFactInput[] = [];
    const push = (field: string, value: string | number | null | undefined) => {
      if (value === null || value === undefined || value === "") return;
      facts.push({
        shipmentId: ctx.shipmentId,
        field: lineItemFactField(item.lineNumber, field),
        value: String(value),
        sourceType: ctx.sourceType,
        documentId: ctx.documentId ?? null,
      });
    };
    push("description", item.description);
    push("partNumber", item.partNumber);
    push("quantity", item.quantity);
    push("unitPrice", item.unitPrice);
    push("totalValue", item.totalValue);
    push("countryOfOrigin", item.countryOfOrigin);
    push("htsCode", item.htsCode);
    push("eccnCode", item.eccnCode);
    await FactService.recordMany(facts);
  }

  private static async applyOne(ctx: ApplyDiscoveriesInput, item: LineItemDiscovery): Promise<void> {
    // Unconditional: the context object accumulates regardless of whether
    // this discovery is allowed to touch the curated record below.
    await this.recordFacts(ctx, item);

    const existing = await db.shipmentLineItem.findFirst({
      where: { shipmentId: ctx.shipmentId, lineNumber: item.lineNumber },
    });

    if (!existing) {
      await this.create(ctx, item);
      return;
    }
    await this.fillEmpty(existing, item);
  }

  private static async create(ctx: ApplyDiscoveriesInput, item: LineItemDiscovery): Promise<void> {
    const quantity = item.quantity ?? LINE_ITEM_SENTINELS.quantity;
    const unitPrice = item.unitPrice ?? LINE_ITEM_SENTINELS.unitPrice;
    const totalValue = item.totalValue ?? quantity * unitPrice;
    const countryOfOrigin = item.countryOfOrigin || LINE_ITEM_SENTINELS.countryOfOrigin;
    const htsCode = item.htsCode || LINE_ITEM_SENTINELS.htsCode;
    const description = item.description || LINE_ITEM_SENTINELS.description;

    // A row is flagged for review the moment any of these three had to be
    // placeholdered -- never left missing, but never presented as if it were
    // genuinely known either.
    const wasDefaulted = item.quantity == null || item.unitPrice == null || !item.countryOfOrigin;

    let dutyStackJson: object | undefined = undefined;
    if (htsCode && htsCode !== LINE_ITEM_SENTINELS.htsCode) {
      try {
        const lineInput = { htsCode, countryOfOrigin, quantity, unitPrice, totalValue };
        const htsMap = await loadHtsCodesMap([lineInput]);
        const stack = calculateDutyStack(lineInput, htsMap[htsCode]);
        dutyStackJson = JSON.parse(JSON.stringify(stack));
      } catch (err) {
        console.warn("[lineItemReconciler] Failed to calculate duty stack:", err);
      }
    }

    await db.shipmentLineItem.create({
      data: {
        shipmentId: ctx.shipmentId,
        accountId: ctx.accountId,
        lineNumber: item.lineNumber,
        partNumber: item.partNumber ?? null,
        description,
        quantity,
        unitPrice: new Prisma.Decimal(unitPrice),
        totalValue: new Prisma.Decimal(totalValue),
        countryOfOrigin,
        htsCode,
        htsConfidence: item.htsConfidence ?? null,
        eccnCode: item.eccnCode ?? null,
        status: wasDefaulted ? "Review Required" : "Unreviewed",
        dutyStack: dutyStackJson,
      },
    });
  }

  private static async fillEmpty(existing: ShipmentLineItem, item: LineItemDiscovery): Promise<void> {
    // A reviewed row is fully locked -- from here, only a user edit changes it.
    if (existing.status === "Valid") return;

    const data: Prisma.ShipmentLineItemUpdateInput = {};

    if (existing.htsCode === LINE_ITEM_SENTINELS.htsCode && item.htsCode) {
      data.htsCode = item.htsCode;
      if (item.htsConfidence != null) data.htsConfidence = item.htsConfidence;
    }
    if (existing.countryOfOrigin === LINE_ITEM_SENTINELS.countryOfOrigin && item.countryOfOrigin) {
      data.countryOfOrigin = item.countryOfOrigin;
    }
    if (existing.quantity === LINE_ITEM_SENTINELS.quantity && item.quantity != null && item.quantity !== LINE_ITEM_SENTINELS.quantity) {
      data.quantity = item.quantity;
    }
    if (existing.unitPrice.toNumber() === LINE_ITEM_SENTINELS.unitPrice && item.unitPrice != null && item.unitPrice !== 0) {
      data.unitPrice = new Prisma.Decimal(item.unitPrice);
      if (item.totalValue != null) data.totalValue = new Prisma.Decimal(item.totalValue);
    }
    if (existing.partNumber == null && item.partNumber) data.partNumber = item.partNumber;
    if (existing.eccnCode == null && item.eccnCode) data.eccnCode = item.eccnCode;
    if (existing.description === LINE_ITEM_SENTINELS.description && item.description) data.description = item.description;

    if (Object.keys(data).length === 0) return;

    const finalHts = (data.htsCode as string) ?? existing.htsCode;
    const finalCountry = (data.countryOfOrigin as string) ?? existing.countryOfOrigin;
    const finalQty = typeof data.quantity === "number" ? data.quantity : existing.quantity;
    const finalPrice = data.unitPrice ? Number(data.unitPrice) : existing.unitPrice.toNumber();
    const finalTotal = data.totalValue ? Number(data.totalValue) : existing.totalValue.toNumber();

    if (finalHts && finalHts !== LINE_ITEM_SENTINELS.htsCode) {
      try {
        const lineInput = { htsCode: finalHts, countryOfOrigin: finalCountry, quantity: finalQty, unitPrice: finalPrice, totalValue: finalTotal };
        const htsMap = await loadHtsCodesMap([lineInput]);
        const stack = calculateDutyStack(lineInput, htsMap[finalHts]);
        data.dutyStack = JSON.parse(JSON.stringify(stack));
      } catch (err) {
        console.warn("[lineItemReconciler] Failed to calculate duty stack on update:", err);
      }
    }

    await db.shipmentLineItem.update({ where: { id: existing.id }, data });
  }

  /**
   * Same fill-only rule, applied to the handful of nullable Shipment columns
   * agents can meaningfully discover (country of origin, incoterm, etc.): an
   * agent may set a field that's currently null, never overwrite one that
   * already has a value. No Shipment.version bump, no ShipmentChangeEvent --
   * this is "adding," not an edit; see shipments/[id]/route.ts and
   * decisions/route.ts for the user-edit path that does version the shipment.
   */
  static async fillShipmentFields(
    shipmentId: string,
    discovery: Partial<Pick<Prisma.ShipmentUpdateInput, "countryOfOrigin" | "incoterm" | "countryOfExport" | "portOfEntry" | "carrierName" | "entryType">>
  ): Promise<void> {
    const shipment = await db.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) return;

    const data: Prisma.ShipmentUpdateInput = {};
    for (const [key, value] of Object.entries(discovery) as Array<[keyof typeof discovery, string | null | undefined]>) {
      if (!value) continue;
      if (!shipment[key as keyof typeof shipment]) {
        (data as Record<string, unknown>)[key] = value;
      }
    }

    if (Object.keys(data).length === 0) return;
    await db.shipment.update({ where: { id: shipmentId }, data });
  }
}
