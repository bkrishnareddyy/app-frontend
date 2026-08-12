import { db } from "@/lib/db";
import { MockCustomsTransmissionProvider } from "@/lib/providers";
import { computeFilingTariff, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { applyTransition, FilingTransitionError } from "./filingStateMachine";
import { ENTRY_TYPE_CODES, normalizeEntryType } from "@/modules/filing/entryType";

export interface FilingCreateInput {
  shipmentId: string;
  entryNumber: string;
  importerOfRecordId?: string;
  bondId?: string;
  entryType: string;
  authority?: string;
}

/** Shape frozen into FilingSnapshot.snapshotData at transmission. */
export type FilingSnapshotData = {
  shipment: {
    id: string;
    shipmentNumber: string;
    importerName: string;
    portOfEntry: string | null;
    carrierName: string | null;
    incoterm: string | null;
    entryType: string | null;
  };
  lineItems: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
    totalValue: number;
    htsCode: string;
    countryOfOrigin: string;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    docType: string;
  }>;
  filingHeader: {
    entryNumber: string;
    entryType: string;
    totalValue: number;
    totalDuties: number;
    totalTaxes: number;
    totalAmount: number;
  };
  metadata: {
    generator: string;
    version: number;
    timestamp: string;
  };
};

export class FilingService {
  static async createFiling(accountId: string, userId: string, input: FilingCreateInput) {
    // Block 2 of the Form 7501. Was defaulted to "Consumption Entry", so a
    // warehouse or FTZ entry was recorded as a consumption entry.
    if (!input.entryType) {
      throw new Error("entryType is required to create a filing.");
    }

    const entryTypeCode = normalizeEntryType(input.entryType);
    if (!entryTypeCode) {
      throw new Error(
        `"${input.entryType}" is not a CBP entry type. Use one of: ${ENTRY_TYPE_CODES.join(", ")}.`
      );
    }

    // Validate shipment belongs to account
    const shipment = await db.shipment.findFirst({
      where: { id: input.shipmentId, accountId, deletedAt: null },
      omit: { filingDeadline: true },
      include: { lineItems: true },
    });

    if (!shipment) {
      throw new Error("Shipment not found or does not belong to active account.");
    }

    // Scoped to the account: a global check would let one tenant probe another
    // tenant's entry numbers and would block legitimate filings.
    const existing = await db.customsFiling.findFirst({
      where: { entryNumber: input.entryNumber, accountId },
    });

    if (existing) {
      throw new Error(`Entry number ${input.entryNumber} is already registered.`);
    }

    const totalVal = shipment.lineItems.reduce((acc, l) => acc + Number(l.totalValue), 0);

    const filing = await db.customsFiling.create({
      data: {
        accountId,
        shipmentId: shipment.id,
        entryNumber: input.entryNumber,
        importerOfRecordId: input.importerOfRecordId,
        bondId: input.bondId,
        entryType: entryTypeCode,
        authority: input.authority || "US Customs (CBP)",
        filingStatus: "Draft",
        totalValue: totalVal,
        // Duties and taxes stay null until a real rate calculation runs. The
        // previous flat 2.8% of value was invented and had no HTS basis.
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

    // The old guard only rejected two hardcoded statuses, so a Cancelled,
    // Rejected or unvalidated filing could still be transmitted.
    let nextStatus: string;
    try {
      nextStatus = applyTransition(filing.filingStatus, "transmit.send");
    } catch (error) {
      if (error instanceof FilingTransitionError) {
        throw new Error(error.message);
      }
      throw error;
    }

    if (!filing.shipment.lineItems || filing.shipment.lineItems.length === 0) {
      throw new Error("Cannot submit entry filing without line items.");
    }

    // An entry summary declares the duty owed. If any line has no published rate
    // the total understates that duty, and transmitting it is a misdeclaration.
    const tariff = computeFilingTariff(
      filing.shipment.lineItems,
      await loadHtsCodesMap(filing.shipment.lineItems)
    );

    if (tariff.unratedLineCount > 0) {
      throw new Error(
        `Cannot transmit: ${tariff.unratedLineCount} of ${filing.shipment.lineItems.length} line(s) have no published duty rate, so the declared duty would understate the amount owed.`
      );
    }

    const snapshotData: FilingSnapshotData = {
      shipment: {
        id: filing.shipment.id,
        shipmentNumber: filing.shipment.shipmentNumber,
        importerName: filing.shipment.importerName,
        portOfEntry: filing.shipment.portOfEntry,
        carrierName: filing.shipment.carrierName,
        incoterm: filing.shipment.incoterm,
        entryType: filing.shipment.entryType,
      },
      lineItems: filing.shipment.lineItems.map(item => ({
        id: item.id,
        lineNumber: item.lineNumber,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalValue: Number(item.totalValue),
        htsCode: item.htsCode,
        countryOfOrigin: item.countryOfOrigin,
      })),
      documents: filing.shipment.documents.map(doc => ({
        id: doc.id,
        fileName: doc.fileName,
        docType: doc.docType,
      })),
      filingHeader: {
        entryNumber: filing.entryNumber,
        entryType: filing.entryType,
        totalValue: Number(filing.totalValue),
        totalDuties: Number(filing.totalDuties),
        totalTaxes: Number(filing.totalTaxes),
        totalAmount: Number(filing.totalAmount),
      },
      metadata: {
        generator: "Qubere Compliance Snapshot Engine",
        version: filing.version,
        timestamp: new Date().toISOString(),
      }
    };

    // Save the snapshot in db
    await db.filingSnapshot.create({
      data: {
        filingId,
        snapshotData,
      }
    });

    const provider = new MockCustomsTransmissionProvider();
    const result = await provider.submitEntry({ entryNumber: filing.entryNumber });

    const updatedFiling = await db.customsFiling.update({
      where: { id: filingId },
      data: {
        filingStatus: nextStatus,
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
