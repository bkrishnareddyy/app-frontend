import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { HtsNodeRepository } from "@/repositories/htsNodeRepository";

export interface SearchOptions {
  q?: string;
  asOfDate?: Date | string;
  level?: number;
  chapter?: string;
  limit?: number;
  offset?: number;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
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
    const releaseId = await this.resolveReleaseId(options.asOfDate);
    const limit = clampInt(options.limit, 20, 1, 200);
    const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    if (options.q) {
      const q = options.q.trim();
      const normQ = q.toLowerCase().replace(/[^0-9a-z.\s]/g, "");
      const likePattern = `%${q}%`;
      const normPattern = `%${normQ}%`;

      // Every filter is bound as a parameter: these values reach $queryRawUnsafe
      // straight from the query string, so interpolating them would be injectable.
      const filterParams: unknown[] = [normPattern, likePattern];
      const filterClauses: string[] = [];

      if (releaseId) {
        filterParams.push(releaseId);
        filterClauses.push(`AND n."releaseId" = $${filterParams.length}`);
      }
      if (options.level) {
        filterParams.push(options.level);
        filterClauses.push(`AND n."codeLevel" = $${filterParams.length}`);
      }
      if (options.chapter) {
        filterParams.push(options.chapter);
        filterClauses.push(`AND n."chapter" = $${filterParams.length}`);
      }

      const filterSql = filterClauses.join("\n          ");
      const matchSql = `
          WHERE (
            n."htsNumberNormalized" ILIKE $1
            OR n."htsNumberDisplay" ILIKE $1
            OR n.description ILIKE $2
          )
          ${filterSql}`;

      type RawNode = { id: string };

      const matchedNodes = await db.$queryRawUnsafe<RawNode[]>(
        `
          SELECT DISTINCT n.id
          FROM "HtsNode" n
          ${matchSql}
          ORDER BY n.id
          LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
        `,
        ...filterParams,
        limit,
        offset
      );

      const countResult = await db.$queryRawUnsafe<[{ count: string }]>(
        `
          SELECT COUNT(DISTINCT n.id)::text as count
          FROM "HtsNode" n
          ${matchSql}
        `,
        ...filterParams
      );

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
    const where: Prisma.HtsNodeWhereInput = { ...(releaseId ? { releaseId } : {}) };
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
