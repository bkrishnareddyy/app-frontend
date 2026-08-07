import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

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

    try {
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
    } catch (err) {
      return { items: [], total: 0 };
    }
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
