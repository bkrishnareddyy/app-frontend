import { db } from "@/lib/db";
import { HtsNodeRepository } from "@/repositories/htsNodeRepository";

export interface SearchOptions {
  q?: string;
  asOfDate?: Date | string;
  level?: number;
  chapter?: string;
  limit?: number;
  offset?: number;
}

export class HtsSearchService {
  /**
   * Resolves the effective HTS release ID for a given asOfDate or current
   * active release, scoped to a country (default "US" -- the only country
   * actually ingested today; the ingestion pipeline itself is still
   * US-only, this scoping is groundwork for when that changes).
   */
  static async resolveReleaseId(asOfDate?: Date | string, country: string = "US"): Promise<string | undefined> {
    try {
      if (asOfDate) {
        const targetDate = new Date(asOfDate);
        const active = await db.htsRelease.findFirst({
          where: {
            country,
            effectiveFrom: { lte: targetDate },
            publicationStatus: { in: ["PUBLISHED", "SUPERSEDED"] },
          },
          orderBy: { effectiveFrom: "desc" },
        });
        if (active) return active.id;
      }

      const current = await db.htsRelease.findFirst({
        where: { country, publicationStatus: "PUBLISHED" },
        orderBy: { effectiveFrom: "desc" },
      });

      return current?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Hierarchical HTS search with optional historical asOfDate filter.
   * Uses raw SQL ILIKE for description search — avoids PgBouncer Transaction Mode
   * incompatibility with Prisma's mode:"insensitive" prepared statement variant.
   */
  static async search(options: SearchOptions) {
    try {
      const releaseId = await this.resolveReleaseId(options.asOfDate);
      const limit = options.limit || 20;
      const offset = options.offset || 0;

      if (options.q) {
        const q = options.q.trim();
        const normQ = q.toLowerCase().replace(/[^0-9a-z.\s]/g, "");
        const likePattern = `%${q}%`;
        const normPattern = `%${normQ}%`;

        // Build WHERE clause
        const releaseClause = releaseId ? `AND n."releaseId" = '${releaseId}'` : "";
        const levelClause = options.level ? `AND n."codeLevel" = ${options.level}` : "";
        const chapterClause = options.chapter ? `AND n."chapter" = '${options.chapter}'` : "";

        type RawNode = { id: string };

        const matchedNodes = await db.$queryRawUnsafe<RawNode[]>(`
          SELECT DISTINCT n.id
          FROM "HtsNode" n
          WHERE (
            n."htsNumberNormalized" ILIKE $1
            OR n."htsNumberDisplay" ILIKE $1
            OR n.description ILIKE $2
          )
          ${releaseClause}
          ${levelClause}
          ${chapterClause}
          ORDER BY n.id
          LIMIT ${limit} OFFSET ${offset}
        `, normPattern, likePattern);

        const countResult = await db.$queryRawUnsafe<[{ count: string }]>(`
          SELECT COUNT(DISTINCT n.id)::text as count
          FROM "HtsNode" n
          WHERE (
            n."htsNumberNormalized" ILIKE $1
            OR n."htsNumberDisplay" ILIKE $1
            OR n.description ILIKE $2
          )
          ${releaseClause}
          ${levelClause}
          ${chapterClause}
        `, normPattern, likePattern);

        const ids = matchedNodes.map((r) => r.id);
        const total = parseInt(countResult[0]?.count || "0", 10);

        if (ids.length === 0) return { items: [], total, releaseId };

        const items = await db.htsNode.findMany({
          where: { id: { in: ids } },
          include: { dutyRates: true, units: true },
          orderBy: [{ htsNumberNormalized: "asc" }, { sourceRowNumber: "asc" }],
        });

        return { items, total, releaseId };
      }

      // No query — just paginate with filters
      const where: any = { ...(releaseId ? { releaseId } : {}) };
      if (options.level) where.codeLevel = options.level;
      if (options.chapter) where.chapter = options.chapter;

      const [items, total] = await Promise.all([
        db.htsNode.findMany({
          where,
          include: { dutyRates: true, units: true },
          take: limit,
          skip: offset,
          orderBy: [{ htsNumberNormalized: "asc" }, { sourceRowNumber: "asc" }],
        }),
        db.htsNode.count({ where }),
      ]);

      return { items, total, releaseId };
    } catch (err: any) {
      console.error("[HtsSearchService.search] error:", err?.message);
      return { items: [], total: 0, releaseId: undefined, error: err?.message };
    }
  }

  /**
   * Get HTS node by 10-digit or 8-digit code.
   */
  static async getCodeDetail(code: string, asOfDate?: Date | string) {
    try {
      const releaseId = await this.resolveReleaseId(asOfDate);
      const normalized = code.replace(/[^0-9]/g, "");

      const node = await db.htsNode.findFirst({
        where: {
          htsNumberNormalized: normalized,
          ...(releaseId ? { releaseId } : {}),
        },
        include: {
          dutyRates: true,
          units: true,
          noteLinks: {
            include: {
              fragment: {
                include: {
                  legalDocument: true,
                },
              },
            },
          },
        },
      });

      return node;
    } catch {
      return null;
    }
  }

  /**
   * Get full parent-child hierarchy path for an HTS code.
   */
  static async getHierarchy(code: string, asOfDate?: Date | string) {
    const node = await this.getCodeDetail(code, asOfDate);
    if (!node) return [];

    return HtsNodeRepository.getHierarchyPath(node.id);
  }

  /**
   * Get list of published and historical HTS releases.
   */
  static async getReleases() {
    try {
      return await db.htsRelease.findMany({
        orderBy: { effectiveFrom: "desc" },
      });
    } catch {
      return [];
    }
  }

  /**
   * Get current active HTS release.
   */
  static async getCurrentRelease() {
    try {
      return await db.htsRelease.findFirst({
        where: { publicationStatus: "PUBLISHED" },
        orderBy: { effectiveFrom: "desc" },
      });
    } catch {
      return null;
    }
  }
}
