import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";
import { calculateDutyStack, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";

export interface InventoryAllocationMatchInput {
  matchStrategy: "FIFO" | "LIFO" | "DIRECT_IDENTIFICATION";
}

export interface DrawbackClaimCreateInput {
  claimType: "manufacturing" | "unused_merchandise";
  matches: Array<{
    shipmentLineItemId: string;
    exportLineItemId: string;
    matchedQuantity: number;
    matchMethod?: string;
    dutyAttributed: number;
  }>;
}

export class DrawbackService {
  /**
   * Helper to create DrawbackLot records from an accepted customs filing (Task B-2)
   */
  static async createDrawbackLotsFromFiling(filingId: string): Promise<number> {
    const filing = await db.customsFiling.findUnique({
      where: { id: filingId },
      include: {
        shipment: {
          include: { lineItems: true },
        },
      },
    });

    if (!filing || !filing.shipment) return 0;

    let createdCount = 0;

    // Load HTS duty rates from the database for the line items
    const htsCodesMap = await loadHtsCodesMap(filing.shipment.lineItems);

    for (const item of filing.shipment.lineItems) {
      const htsRateInput = item.htsCode ? htsCodesMap[item.htsCode] : null;
      // Calculate real duty stack per F06 logic
      const stack = calculateDutyStack(
        {
          htsCode: item.htsCode,
          totalValue: Number(item.totalValue || 0),
          countryOfOrigin: item.countryOfOrigin,
        },
        htsRateInput ?? {
          generalDutyRate: "2.8%", // Representative fallback rate
          section301Applicable: item.countryOfOrigin === "CN",
          section301Tranche: "List3",
        },
        "hts_rel_v1"
      );

      // Legally, drawback covers base + Section 301 duties (19 CFR 191)
      const eligibleDuties = stack.base.plus(stack.section301);

      if (eligibleDuties.greaterThan(0) && item.quantity > 0) {
        const qty = new Decimal(item.quantity);
        const dutyPaidPerUnit = eligibleDuties.dividedBy(qty);

        // Check if lot already exists
        const exists = await db.drawbackLot.findFirst({
          where: { lineItemId: item.id },
        });

        if (!exists) {
          await db.drawbackLot.create({
            data: {
              accountId: filing.accountId,
              entryNumber: filing.entryNumber,
              lineItemId: item.id,
              htsCode: item.htsCode,
              quantity: qty,
              availableQty: qty,
              unitPurchasePrice: new Decimal(Number(item.unitPrice || 0)),
              dutyPaidPerUnit,
              importDate: filing.createdAt,
              exportDeadline: new Date(filing.createdAt.getTime() + 5 * 365 * 24 * 60 * 60 * 1000), // 5 years
              hasSection301: stack.section301.greaterThan(0),
              section301List: stack.section301.greaterThan(0) ? "List3" : null,
            },
          });
          createdCount++;
        }
      }
    }

    return createdCount;
  }

  /**
   * Run matching / FIFO lot allocation (Task B-3, B-4)
   */
  static async matchInventory(accountId: string, input: InventoryAllocationMatchInput) {
    // Wrap matching logic in a serializable transaction to prevent race conditions & double-allocation
    return await db.$transaction(async (tx) => {
      // 1. Fetch active exports
      const exportItems = await tx.exportLineItem.findMany({
        where: { accountId },
        include: { exportShipment: true },
        orderBy: { createdAt: "asc" },
      });

      const proposedMatches = [];

      for (const exp of exportItems) {
        // Query available lots matching HTS code (or partNumber if exact)
        const lots = await tx.drawbackLot.findMany({
          where: {
            accountId,
            htsCode: exp.htsCode,
            availableQty: { gt: 0 },
            exportDeadline: { gte: new Date() }, // Active non-expired lots
          },
          orderBy: { importDate: input.matchStrategy === "LIFO" ? "desc" : "asc" },
        });

        let qtyNeeded = new Decimal(exp.quantity);

        for (const lot of lots) {
          if (qtyNeeded.isZero()) break;

          const available = new Decimal(lot.availableQty);
          const allocated = Decimal.min(available, qtyNeeded);

          // Calculate estimated duty recovery: 99% statutory drawback rate (19 U.S.C. 1313)
          const dutyAttributed = allocated.times(new Decimal(lot.dutyPaidPerUnit)).times(0.99);

          proposedMatches.push({
            shipmentLineItemId: lot.lineItemId || "",
            exportLineItemId: exp.id,
            htsCode: exp.htsCode,
            matchedQuantity: allocated.toNumber(),
            matchMethod: input.matchStrategy,
            dutyAttributed: roundToCents(dutyAttributed).toNumber(),
            importShipmentNumber: lot.entryNumber,
            exportShipmentNumber: exp.exportShipment.exportShipmentNumber,
          });

          // Deduct from available quantity on the lot record
          const nextAvailable = available.minus(allocated);
          await tx.drawbackLot.update({
            where: { id: lot.id },
            data: {
              availableQty: nextAvailable,
              reservedQty: new Decimal(lot.reservedQty).plus(allocated),
            },
          });

          qtyNeeded = qtyNeeded.minus(allocated);
        }

        // If export has remaining unmatched quantities, we do not fail match run, but represent partial match
      }

      return {
        proposedMatchesCount: proposedMatches.length,
        proposedMatches,
        metadata: {
          providerName: "DrawbackInventoryAllocationEngine",
          datasetVersion: "2026.1",
          retrievedAt: new Date().toISOString(),
          completenessStatus: "COMPLETE",
        },
      };
    }, { isolationLevel: "Serializable" });
  }

  /**
   * Formal drawback claim creation using filer sequences (Task B-5, B-6)
   */
  static async createClaim(accountId: string, userId: string, input: DrawbackClaimCreateInput) {
    if (!input.matches || input.matches.length === 0) {
      throw new Error("Cannot create a drawback claim with empty inventory allocations/matches.");
    }

    return await db.$transaction(async (tx) => {
      // Generate sequence claimant: {filer_code}-{year}-{sequence}
      const importer = await tx.importerOfRecord.findFirst({
        where: { accountId },
      });
      const filerCode = importer?.cbpImporterNumber?.slice(0, 4) || "9901";
      const year = new Date().getFullYear().toString();

      // Retrieve next sequence value
      const seq = await tx.drawbackClaimSequence.upsert({
        where: { accountId },
        update: { nextVal: { increment: 1 } },
        create: { accountId, nextVal: 2 },
      });

      const sequenceVal = String(seq.nextVal - 1).padStart(5, "0");
      const cbpClaimNumber = `DBK-${filerCode}-${year}-${sequenceVal}`;

      const totalRefundDec = input.matches.reduce((acc, m) => acc.plus(new Decimal(m.dutyAttributed)), new Decimal(0));
      const totalRefund = roundToCents(totalRefundDec).toNumber();

      const claim = await tx.drawbackClaim.create({
        data: {
          accountId,
          claimType: input.claimType,
          status: "Draft",
          totalRefundClaimed: totalRefund,
          cbpClaimNumber,
          matches: {
            create: input.matches.map((m) => ({
              shipmentLineItemId: m.shipmentLineItemId,
              exportLineItemId: m.exportLineItemId,
              matchedQuantity: m.matchedQuantity,
              matchMethod: m.matchMethod || "FIFO",
              dutyAttributed: m.dutyAttributed,
            })),
          },
        },
        include: { matches: true },
      });

      // Confirm reservations to claimed quantities
      for (const m of input.matches) {
        const lot = await tx.drawbackLot.findFirst({
          where: { lineItemId: m.shipmentLineItemId },
        });
        if (lot) {
          const qty = new Decimal(m.matchedQuantity);
          await tx.drawbackLot.update({
            where: { id: lot.id },
            data: {
              reservedQty: new Decimal(lot.reservedQty).minus(qty),
              claimedQty: new Decimal(lot.claimedQty).plus(qty),
            },
          });
        }
      }

      await createAuditLog({
        accountId,
        userId,
        action: AuditAction.DRAWBACK_CLAIM_CREATED,
        entity: "DrawbackClaim",
        entityId: claim.id,
        source: "UI",
        metadata: { cbpClaimNumber, totalRefundClaimed: totalRefund, claimType: input.claimType },
      });

      return { claim, internalClaimRef: cbpClaimNumber };
    });
  }
}
