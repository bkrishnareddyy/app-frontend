import { db } from "@/lib/db";
import { MockCustomsTransmissionProvider } from "@/lib/providers";

export interface FilingCreateInput {
  shipmentId: string;
  entryNumber: string;
  importerOfRecordId?: string;
  bondId?: string;
  entryType?: string;
  authority?: string;
}

export class FilingService {
  static async createFiling(accountId: string, userId: string, input: FilingCreateInput) {
    // Validate shipment belongs to account
    const shipment = await db.shipment.findFirst({
      where: { id: input.shipmentId, accountId, deletedAt: null },
      include: { lineItems: true },
    });

    if (!shipment) {
      throw new Error("Shipment not found or does not belong to active account.");
    }

    // Check duplicate entry number
    const existing = await db.customsFiling.findFirst({
      where: { entryNumber: input.entryNumber },
    });

    if (existing) {
      throw new Error(`Entry number ${input.entryNumber} is already registered.`);
    }

    const totalVal = shipment.lineItems.reduce((acc, l) => acc + l.totalValue, 0);
    const totalDuty = Math.round(shipment.lineItems.reduce((acc, l) => acc + (l.totalValue * 0.028), 0) * 100) / 100;

    const filing = await db.customsFiling.create({
      data: {
        accountId,
        shipmentId: shipment.id,
        entryNumber: input.entryNumber,
        importerOfRecordId: input.importerOfRecordId,
        bondId: input.bondId,
        entryType: input.entryType || "Consumption Entry",
        authority: input.authority || "US Customs (CBP)",
        filingStatus: "Draft",
        totalValue: totalVal,
        totalDuties: totalDuty,
        totalTaxes: 0,
        totalAmount: totalDuty,
      },
      include: { shipment: true },
    });

    return filing;
  }

  static async transmitFiling(accountId: string, userId: string, filingId: string) {
    const filing = await db.customsFiling.findFirst({
      where: { id: filingId, accountId },
      include: { shipment: { include: { documents: true, lineItems: true } } },
    });

    if (!filing) {
      throw new Error("NOT_FOUND");
    }

    if (filing.filingStatus === "Submitted" || filing.filingStatus === "Accepted") {
      throw new Error("Filing has already been submitted.");
    }

    if (!filing.shipment.lineItems || filing.shipment.lineItems.length === 0) {
      throw new Error("Cannot submit entry filing without line items.");
    }

    const provider = new MockCustomsTransmissionProvider();
    const result = await provider.submitEntry({ entryNumber: filing.entryNumber });

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: {
        filingStatus: "Submitted",
        submittedAt: new Date(),
        version: { increment: 1 },
      },
    });

    const response = await db.customsResponse.create({
      data: {
        accountId,
        filingId,
        code: result.responseCode,
        title: "ACK - ABI Entry Transmission Received",
        description: result.message,
        status: result.status,
      },
    });

    return { filing: updatedFiling, response, transmissionResult: result };
  }
}
