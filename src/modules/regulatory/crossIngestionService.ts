import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export interface IngestRulingInput {
  rulingNumber: string;
  issuedAt: Date | string;
  title: string;
  office?: string;
  rulingType?: string;
  sourceUrl?: string;
  htsCodes: string[];
  fragments: Array<{ fragmentType: string; text: string }>;
  accountId?: string;
  userId?: string;
}

export class CrossIngestionService {
  /**
   * Ingests an official CBP CROSS ruling into the authoritative database index.
   */
  static async ingestRuling(input: IngestRulingInput) {
    const issuedAt = new Date(input.issuedAt);

    const ruling = await db.ruling.upsert({
      where: { rulingNumber: input.rulingNumber },
      update: {
        title: input.title,
        office: input.office || "HQ",
        issuedAt,
        sourceUrl: input.sourceUrl || `https://rulings.cbp.gov/ruling/${input.rulingNumber}`,
      },
      create: {
        rulingNumber: input.rulingNumber,
        issuedAt,
        title: input.title,
        office: input.office || "HQ",
        rulingType: input.rulingType || "HQ",
        sourceUrl: input.sourceUrl || `https://rulings.cbp.gov/ruling/${input.rulingNumber}`,
        htsReferences: {
          create: input.htsCodes.map((code) => ({
            htsNumberDisplay: code,
            relationType: "CLASSIFIED_AS",
          })),
        },
        fragments: {
          create: input.fragments.map((f) => ({
            fragmentType: f.fragmentType,
            text: f.text,
          })),
        },
      },
      include: {
        fragments: true,
        htsReferences: true,
      },
    });

    if (input.accountId && input.userId) {
      await createAuditLog({
        accountId: input.accountId,
        userId: input.userId,
        action: "regulatory.ruling.ingest",
        entity: "Ruling",
        entityId: ruling.id,
        metadata: { rulingNumber: input.rulingNumber, htsCodes: input.htsCodes },
      });
    }

    return ruling;
  }

  /**
   * Anti-hallucination verification: Ensures a proposed CROSS ruling exists in the verified database.
   */
  static async verifyCitation(rulingNumber: string) {
    try {
      const ruling = await db.ruling.findUnique({
        where: { rulingNumber },
        include: {
          fragments: true,
          htsReferences: true,
        },
      });

      if (!ruling) {
        return {
          verified: false,
          rulingNumber,
          reason: `Citation '${rulingNumber}' rejected: Not found in verified CBP CROSS database. Zero-hallucination policy enforced.`,
        };
      }

      return {
        verified: true,
        rulingNumber,
        ruling,
      };
    } catch (err) {
      return {
        verified: false,
        rulingNumber,
        reason: `Citation '${rulingNumber}' rejected: Not found in verified CBP CROSS database. Zero-hallucination policy enforced.`,
      };
    }
  }
}
