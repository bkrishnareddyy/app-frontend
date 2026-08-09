import { db } from "@/lib/db";

export interface EntityMatchCandidate {
  legalEntityId: string;
  legalName: string;
  matchScore: number; // 0 - 100
  matchReason: string;
  customsProfileId?: string;
  cbpImporterNumber?: string;
}

export interface EntityResolutionInput {
  accountId: string;
  clientId?: string | null;
  rawName: string;
  taxIdentifier?: string | null;
  cbpImporterNumber?: string | null;
  addressLine1?: string | null;
  country?: string | null;
}

export class EntityResolutionService {
  /**
   * Normalize company names for fuzzy comparison.
   * e.g. "Target USA, Inc." -> "target usa"
   */
  static normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(inc|corp|corporation|llc|ltd|limited|co|company|pvt|gmbh|sa|plc)\b\.?/gi, "")
      .replace(/[^a-z0-9\s]/gi, "")
      .trim();
  }

  /**
   * Resolve raw parsed document text or input to existing LegalEntity records.
   */
  static async resolveEntity(input: EntityResolutionInput): Promise<{
    bestMatch: EntityMatchCandidate | null;
    candidates: EntityMatchCandidate[];
  }> {
    if (!input.rawName || input.rawName.trim().length === 0) {
      return { bestMatch: null, candidates: [] };
    }

    const normInputName = this.normalizeName(input.rawName);

    // 1. Fetch all candidate LegalEntities for the account
    const entities = await db.legalEntity.findMany({
      where: {
        accountId: input.accountId,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        status: "ACTIVE",
      },
      include: {
        customsProfiles: {
          where: { active: true },
        },
      },
    });

    const candidates: EntityMatchCandidate[] = [];

    for (const entity of entities) {
      let score = 0;
      const reasons: string[] = [];

      // A. CBP Importer Number exact match (High confidence: +100)
      const matchingCustomsProfile = entity.customsProfiles.find(
        (cp) =>
          input.cbpImporterNumber &&
          cp.cbpImporterNumber &&
          cp.cbpImporterNumber.replace(/[^a-zA-Z0-9]/g, "") ===
            input.cbpImporterNumber.replace(/[^a-zA-Z0-9]/g, "")
      );

      if (matchingCustomsProfile) {
        score += 100;
        reasons.push(`Exact CBP Importer Number match (${matchingCustomsProfile.cbpImporterNumber})`);
      }

      // B. Tax Identifier / EIN match (+90)
      if (
        input.taxIdentifier &&
        entity.taxIdentifier &&
        input.taxIdentifier.replace(/[^0-9]/g, "") === entity.taxIdentifier.replace(/[^0-9]/g, "")
      ) {
        score += 90;
        reasons.push(`Tax ID / EIN match (${entity.taxIdentifier})`);
      }

      // C. Exact Legal Name match (+95)
      if (entity.legalName.toLowerCase().trim() === input.rawName.toLowerCase().trim()) {
        score += 95;
        reasons.push("Exact legal name match");
      } else {
        // D. Normalized Name match (+80)
        const normEntityName = this.normalizeName(entity.legalName);
        if (normEntityName && normInputName && (normEntityName === normInputName || normEntityName.includes(normInputName) || normInputName.includes(normEntityName))) {
          score += 80;
          reasons.push("Normalized company name match");
        }
      }

      // E. Trade Name match (+75)
      if (entity.tradeName && this.normalizeName(entity.tradeName) === normInputName) {
        score += 75;
        reasons.push("Trade name / DBA match");
      }

      if (score > 0) {
        candidates.push({
          legalEntityId: entity.id,
          legalName: entity.legalName,
          matchScore: Math.min(score, 100),
          matchReason: reasons.join("; "),
          customsProfileId: matchingCustomsProfile?.id,
          cbpImporterNumber: matchingCustomsProfile?.cbpImporterNumber || undefined,
        });
      }
    }

    candidates.sort((a, b) => b.matchScore - a.matchScore);

    const bestMatch = candidates.length > 0 && candidates[0].matchScore >= 75 ? candidates[0] : null;

    return { bestMatch, candidates };
  }

  /**
   * Helper to find or auto-create a LegalEntity when confidence is sufficient or user approves.
   */
  static async findOrCreateEntity(
    accountId: string,
    rawName: string,
    options?: {
      clientId?: string | null;
      country?: string;
      taxIdentifier?: string;
      cbpImporterNumber?: string;
    }
  ) {
    const resolution = await this.resolveEntity({
      accountId,
      rawName,
      clientId: options?.clientId,
      taxIdentifier: options?.taxIdentifier,
      cbpImporterNumber: options?.cbpImporterNumber,
    });

    if (resolution.bestMatch && resolution.bestMatch.matchScore >= 90) {
      return db.legalEntity.findUnique({
        where: { id: resolution.bestMatch.legalEntityId },
        include: { customsProfiles: true },
      });
    }

    // Create new LegalEntity
    const newEntity = await db.legalEntity.create({
      data: {
        accountId,
        clientId: options?.clientId || null,
        legalName: rawName.trim(),
        country: options?.country || "US",
        taxIdentifier: options?.taxIdentifier || null,
        status: "ACTIVE",
        ...(options?.cbpImporterNumber
          ? {
              customsProfiles: {
                create: {
                  cbpImporterNumber: options.cbpImporterNumber,
                  active: true,
                },
              },
            }
          : {}),
      },
      include: { customsProfiles: true },
    });

    return newEntity;
  }
}
