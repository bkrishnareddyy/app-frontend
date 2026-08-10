import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

/** The two CROSS ruling types. */
export const RULING_TYPES = ["HQ", "NY"] as const;

export interface IngestRulingInput {
  rulingNumber: string;
  issuedAt: Date | string;
  title: string;
  office?: string;
  rulingType: string;
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

    // Was defaulted to "HQ", which filed every New York ruling under the wrong
    // issuing authority in the index verifyCitation() treats as authoritative.
    if (!RULING_TYPES.includes(input.rulingType as (typeof RULING_TYPES)[number])) {
      throw new Error(`rulingType must be one of: ${RULING_TYPES.join(", ")}`);
    }

    // Both columns are nullable. A constructed rulings.cbp.gov URL asserts a
    // published source nobody fetched, and "HQ" invented the issuing office.
    const office = input.office ?? null;
    const sourceUrl = input.sourceUrl ?? null;

    const ruling = await db.ruling.upsert({
      where: { rulingNumber: input.rulingNumber },
      update: {
        title: input.title,
        office,
        issuedAt,
        sourceUrl,
      },
      create: {
        rulingNumber: input.rulingNumber,
        issuedAt,
        title: input.title,
        office,
        rulingType: input.rulingType,
        sourceUrl,
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
    // A lookup failure is deliberately not caught here: reporting it as an
    // unverified citation would state the ruling does not exist when we simply
    // could not check. The caller turns a thrown error into a 5xx.
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
  }
}
