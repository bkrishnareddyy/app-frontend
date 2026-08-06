import { db } from "@/lib/db";
import { ProviderMetadata } from "@/lib/providers";

export interface BondCreateInput {
  bondType: string;
  suretyName: string;
  bondNumber: string;
  bondAmount: number;
  effectiveDate?: string;
  expirationDate?: string;
  importerOfRecordId?: string;
}

export class BondService {
  static async listBonds(accountId: string) {
    const bonds = await db.bond.findMany({
      where: { accountId },
      include: { importersOfRecord: true },
      orderBy: { createdAt: "desc" },
    });
    return bonds;
  }

  static async createBond(accountId: string, userId: string, input: BondCreateInput) {
    // Check duplicate bond number
    const existing = await db.bond.findUnique({
      where: { bondNumber: input.bondNumber },
    });

    if (existing) {
      throw new Error(`Bond number ${input.bondNumber} already exists`);
    }

    if (input.bondAmount <= 0) {
      throw new Error("Bond amount must be greater than zero");
    }

    const bond = await db.bond.create({
      data: {
        accountId,
        bondType: input.bondType,
        suretyName: input.suretyName,
        bondNumber: input.bondNumber,
        bondAmount: input.bondAmount,
        effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : new Date(),
        expirationDate: input.expirationDate ? new Date(input.expirationDate) : null,
        status: "Unverified", // Explicit unverified status until surety/ACE verification
      },
    });

    if (input.importerOfRecordId) {
      const ior = await db.importerOfRecord.findFirst({
        where: { id: input.importerOfRecordId, accountId },
      });
      if (ior) {
        await db.importerOfRecord.update({
          where: { id: ior.id },
          data: { bondId: bond.id },
        });
      }
    }

    return {
      bond,
      metadata: {
        providerName: "InternalBondRegistry",
        datasetVersion: "2026.1",
        retrievedAt: new Date().toISOString(),
        completenessStatus: "PARTIAL",
      } as ProviderMetadata,
    };
  }
}
