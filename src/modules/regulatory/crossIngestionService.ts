import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import crypto from "crypto";

/** The two CROSS ruling types. */
export const RULING_TYPES = ["HQ", "NY"] as const;

export interface IngestRulingInput {
  rulingNumber: string;
  issuedAt?: Date | string | null;
  title: string;
  office?: string;
  rulingType: string;
  sourceUrl?: string;
  checksum?: string;
  modifiedOrRevokedStatus?: "EFFECTIVE" | "REVOKED" | "MODIFIED";
  modifiesRulingNumber?: string;
  revokesRulingNumber?: string;
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
    if (!input.issuedAt) {
      throw new Error(`rulingNumber '${input.rulingNumber}' is missing an authoritative issue date.`);
    }
    const issuedAt = new Date(input.issuedAt);
    if (isNaN(issuedAt.getTime())) {
      throw new Error(`rulingNumber '${input.rulingNumber}' has an invalid issue date: ${input.issuedAt}`);
    }

    if (!RULING_TYPES.includes(input.rulingType as (typeof RULING_TYPES)[number])) {
      throw new Error(`rulingType must be one of: ${RULING_TYPES.join(", ")}`);
    }

    const office = input.office ?? null;
    const sourceUrl = input.sourceUrl ?? null;
    const status = input.modifiedOrRevokedStatus || "EFFECTIVE";

    // Compute content checksum
    const fullText = input.fragments.map((f) => f.text).join("\n");
    const checksum = input.checksum || crypto.createHash("sha256").update(fullText).digest("hex");

    const ruling = await db.ruling.upsert({
      where: { rulingNumber: input.rulingNumber },
      update: {
        title: input.title,
        office,
        issuedAt,
        sourceUrl,
        checksum,
        modifiedOrRevokedStatus: status,
        lastVerifiedAt: new Date(),
      },
      create: {
        rulingNumber: input.rulingNumber,
        issuedAt,
        title: input.title,
        office,
        rulingType: input.rulingType,
        sourceUrl,
        checksum,
        modifiedOrRevokedStatus: status,
        publicationStatus: "PUBLISHED",
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

    // Create RulingRelationship if this ruling modifies or revokes a target ruling
    const relTargetNumber = input.revokesRulingNumber || input.modifiesRulingNumber;
    if (relTargetNumber) {
      const relType = input.revokesRulingNumber ? "REVOKES" : "MODIFIES";
      const targetRuling = await db.ruling.findUnique({
        where: { rulingNumber: relTargetNumber },
      });

      if (targetRuling) {
        await db.rulingRelationship.upsert({
          where: {
            fromRulingId_toRulingId_relationshipType: {
              fromRulingId: ruling.id,
              toRulingId: targetRuling.id,
              relationshipType: relType,
            },
          },
          update: {},
          create: {
            fromRulingId: ruling.id,
            toRulingId: targetRuling.id,
            relationshipType: relType,
          },
        }).catch((err) => console.warn("[CrossIngestionService] Failed to record ruling relationship:", err));

        // Mark target ruling status as REVOKED or MODIFIED
        await db.ruling.update({
          where: { id: targetRuling.id },
          data: { modifiedOrRevokedStatus: relType === "REVOKES" ? "REVOKED" : "MODIFIED" },
        }).catch(() => {});
      }
    }

    if (input.accountId && input.userId) {
      await createAuditLog({
        accountId: input.accountId,
        userId: input.userId,
        action: AuditAction.REGULATORY_RULING_INGESTED,
        entity: "Ruling",
        entityId: ruling.id,
        source: "UI",
        metadata: { rulingNumber: input.rulingNumber, htsCodes: input.htsCodes, checksum, status },
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
