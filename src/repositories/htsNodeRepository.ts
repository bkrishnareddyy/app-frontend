import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { resolveSection232ForHtsCode, type DutyRateInput } from "@/lib/tariff/dutyEngine";

export interface HtsSearchFilters {
  q?: string;
  asOfDate?: Date;
  level?: number;
  chapter?: string;
  heading?: string;
  limit?: number;
  offset?: number;
}

export class HtsNodeRepository {
  /**
   * Search HTS nodes hierarchically with optional release versioning.
   */
  static async searchNodes(filters: HtsSearchFilters) {
    const where: Prisma.HtsNodeWhereInput = {};

    if (filters.q) {
      const normalizedQ = filters.q.trim().toLowerCase();
      where.OR = [
        { htsNumberNormalized: { contains: normalizedQ } },
        { description: { contains: normalizedQ, mode: "insensitive" } },
        { fullDescription: { contains: normalizedQ, mode: "insensitive" } },
      ];
    }

    if (filters.level) {
      where.codeLevel = filters.level;
    }

    if (filters.chapter) {
      where.chapter = filters.chapter;
    }

    if (filters.heading) {
      where.heading = filters.heading;
    }

    // Not wrapped in try/catch: an empty result set and a failed query mean very
    // different things to a classifier, and returning [] for both hides outages.
    const [items, total] = await Promise.all([
      db.htsNode.findMany({
        where,
        include: {
          dutyRates: true,
          units: true,
        },
        take: filters.limit || 20,
        skip: filters.offset || 0,
        orderBy: [{ htsNumberNormalized: "asc" }, { sourceRowNumber: "asc" }],
      }),
      db.htsNode.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Find a specific HTS node by normalized code.
   */
  static async findByNormalizedCode(normalizedCode: string, releaseId?: string) {
    return db.htsNode.findFirst({
      where: {
        htsNumberNormalized: normalizedCode,
        ...(releaseId ? { releaseId } : {}),
      },
      include: {
        dutyRates: true,
        units: true,
        noteLinks: {
          include: {
            fragment: true,
          },
        },
      },
    });
  }

  /**
   * Adapts a real HtsNode (with dutyRates loaded) into the shape
   * dutyEngine.ts needs. Section 301 is read from the node's own ingested
   * dutyRates (same as loadHtsCodesMap); Section 232 is resolved against the
   * real ingested Section232Rate table. countryOfOrigin is optional -- when
   * the caller doesn't have it, Section 301/232 applicability is reported as
   * NOT_EVALUATED rather than a hardcoded, misleading "not applicable."
   */
  static async toDutyRateInput(
    node: Prisma.HtsNodeGetPayload<{ include: { dutyRates: true } }> | null,
    countryOfOrigin?: string | null
  ): Promise<DutyRateInput> {
    const general = node?.dutyRates.find((r) => r.rateColumn === "General");
    const sec301Rate = node?.dutyRates.find(
      (r) => r.rateType === "SECTION_301" || r.rateColumn === "Section301"
    );

    const country = countryOfOrigin?.toUpperCase() || null;
    let section301Applicable = false;
    let section301AdditionalRate = 0;
    if (sec301Rate) {
      section301Applicable = country ? country === "CN" : true;
      section301AdditionalRate = sec301Rate.adValoremPercent ?? 0;
    }

    const htsCode = node?.htsNumberDisplay ?? node?.htsNumberNormalized ?? "";
    const section232 = htsCode
      ? await resolveSection232ForHtsCode(htsCode, countryOfOrigin)
      : { applicable: false, additionalRate: 0, status: "NOT_EVALUATED" as const };

    return {
      generalDutyRate: general?.rawRateText ?? null,
      generalStatus: node ? (general ? "EVALUATED_APPLICABLE" : "DATA_UNAVAILABLE") : "DATA_UNAVAILABLE",
      section301Applicable,
      section301AdditionalRate,
      section301Status: sec301Rate ? (section301Applicable ? "EVALUATED_APPLICABLE" : "EVALUATED_NOT_APPLICABLE") : "NOT_EVALUATED",
      section232Applicable: section232.applicable,
      section232AdditionalRate: section232.additionalRate,
      section232Status: section232.status,
    };
  }

  /**
   * Reconstruct full parent hierarchy path up to Section / Chapter heading.
   */
  static async getHierarchyPath(nodeId: string) {
    const path: Array<Prisma.HtsNodeGetPayload<{ include: { dutyRates: true } }>> = [];
    let currentId: string | null = nodeId;

    while (currentId) {
      const node: Prisma.HtsNodeGetPayload<{ include: { dutyRates: true } }> | null = await db.htsNode.findUnique({
        where: { id: currentId },
        include: { dutyRates: true },
      });

      if (!node) break;
      path.unshift(node);
      currentId = node.parentId;
    }

    return path;
  }
}
