import { db } from "@/lib/db";
import { ProviderMetadata } from "@/lib/providers";

export interface InventoryAllocationMatchInput {
  matchStrategy: "FIFO" | "LIFO" | "DIRECT_IDENTIFICATION";
}

export interface DrawbackClaimCreateInput {
  claimType: string;
  matches: Array<{
    shipmentLineItemId: string;
    exportLineItemId: string;
    matchedQuantity: number;
    matchMethod?: string;
    dutyAttributed: number;
  }>;
}

export class DrawbackService {
  static async matchInventory(accountId: string, input: InventoryAllocationMatchInput) {
    const importItems = await db.shipmentLineItem.findMany({
      where: { accountId },
      // filingDeadline is in the Prisma schema but not yet applied to the
      // live DB (migration pending) -- must stay omitted or this 500s.
      include: { shipment: { omit: { filingDeadline: true } } },
      orderBy: { createdAt: input.matchStrategy === "LIFO" ? "desc" : "asc" },
    });

    const exportItems = await db.exportLineItem.findMany({
      where: { accountId },
      include: { exportShipment: true },
      orderBy: { createdAt: "asc" },
    });

    const proposedMatches = [];

    for (const exp of exportItems) {
      const matchingImport = importItems.find(
        (imp) => imp.htsCode === exp.htsCode || (imp.partNumber && imp.partNumber === exp.partNumber)
      );

      if (matchingImport && matchingImport.quantity > 0) {
        const matchedQuantity = Math.min(matchingImport.quantity, exp.quantity);
        // Decimal-safe refund calculation: 99% drawback rate on paid duties
        const estDuty = Math.round(matchedQuantity * Number(matchingImport.unitPrice) * 0.028 * 0.99 * 100) / 100;

        proposedMatches.push({
          shipmentLineItemId: matchingImport.id,
          exportLineItemId: exp.id,
          htsCode: exp.htsCode,
          partNumber: exp.partNumber,
          matchedQuantity,
          matchMethod: input.matchStrategy,
          dutyAttributed: estDuty,
          importShipmentNumber: matchingImport.shipment.shipmentNumber,
          exportShipmentNumber: exp.exportShipment.exportShipmentNumber,
        });
      }
    }

    return {
      proposedMatchesCount: proposedMatches.length,
      proposedMatches,
      metadata: {
        providerName: "DrawbackInventoryAllocationEngine",
        datasetVersion: "2026.1",
        retrievedAt: new Date().toISOString(),
        completenessStatus: "COMPLETE",
      } as ProviderMetadata,
    };
  }

  static async createClaim(accountId: string, userId: string, input: DrawbackClaimCreateInput) {
    if (!input.matches || input.matches.length === 0) {
      throw new Error("Cannot create a drawback claim with empty inventory allocations/matches.");
    }

    // Validate ownership of referenced line items
    for (const m of input.matches) {
      const imp = await db.shipmentLineItem.findFirst({
        where: { id: m.shipmentLineItemId, accountId },
      });
      if (!imp) throw new Error(`Invalid import line item reference ${m.shipmentLineItemId}`);

      const exp = await db.exportLineItem.findFirst({
        where: { id: m.exportLineItemId, accountId },
      });
      if (!exp) throw new Error(`Invalid export line item reference ${m.exportLineItemId}`);
    }

    const totalRefund = Math.round(input.matches.reduce((acc, m) => acc + m.dutyAttributed, 0) * 100) / 100;
    const internalClaimRef = `CLAIM-REF-${Date.now().toString(36).toUpperCase()}`;

    const claim = await db.drawbackClaim.create({
      data: {
        accountId,
        claimType: input.claimType,
        status: "Draft",
        totalRefundClaimed: totalRefund,
        cbpClaimNumber: null, // Only populated when assigned by CBP or broker action
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

    return { claim, internalClaimRef };
  }
}
