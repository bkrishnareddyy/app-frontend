import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { RULING_TYPES } from "@/modules/regulatory/crossIngestionService";

export interface RulingSearchOptions {
  htsCode?: string;
  query?: string;
  rulingNumber?: string;
  limit?: number;
}

export type ScoredRuling = Prisma.RulingGetPayload<{
  include: { fragments: true; htsReferences: true };
}> & { relevanceScore?: number };

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by",
  "is", "are", "was", "were", "this", "that", "it", "from", "as", "be", "been",
  "which", "under", "into", "subheading", "heading", "hts", "htsus", "code", "classification"
]);

function extractSearchTokens(query: string): string[] {
  const normalized = query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const tokens = new Set<string>();

  for (const t of rawTokens) {
    if (t.length >= 2 && !STOP_WORDS.has(t)) {
      tokens.add(t);
      if (t.includes("-")) {
        t.split("-").forEach((sub) => {
          if (sub.length >= 2 && !STOP_WORDS.has(sub)) tokens.add(sub);
        });
      }
    }
  }

  return [...tokens];
}

export class RulingService {
  /**
   * Search CBP CROSS Rulings index by HTS code, ruling number, or keyword/phrase similarity.
   * Uses tokenized multi-term matching, fragment searching, and relevance scoring.
   */
  static async searchRulings(options: RulingSearchOptions): Promise<ScoredRuling[]> {
    const limit = options.limit || 5;
    const rawQuery = options.query?.trim() || "";
    const tokens = rawQuery ? extractSearchTokens(rawQuery) : [];
    const normalizedHts = options.htsCode ? options.htsCode.replace(/[^0-9]/g, "") : "";

    const where: Prisma.RulingWhereInput = {};

    if (options.rulingNumber) {
      where.rulingNumber = { contains: options.rulingNumber.trim(), mode: "insensitive" };
    }

    const orConditions: Prisma.RulingWhereInput[] = [];

    if (normalizedHts) {
      orConditions.push({
        htsReferences: {
          some: {
            htsNumberDisplay: { contains: normalizedHts },
          },
        },
      });
      if (normalizedHts.length >= 4) {
        orConditions.push({
          htsReferences: {
            some: {
              htsNumberDisplay: { contains: normalizedHts.slice(0, 4) },
            },
          },
        });
      }
    }

    if (rawQuery) {
      orConditions.push({ title: { contains: rawQuery, mode: "insensitive" } });
      orConditions.push({ fragments: { some: { text: { contains: rawQuery, mode: "insensitive" } } } });

      for (const token of tokens) {
        orConditions.push({ title: { contains: token, mode: "insensitive" } });
        orConditions.push({ fragments: { some: { text: { contains: token, mode: "insensitive" } } } });
      }
    }

    if (orConditions.length > 0) {
      where.OR = orConditions;
    }

    const candidates = await db.ruling.findMany({
      where,
      include: {
        fragments: true,
        htsReferences: true,
      },
      take: rawQuery || normalizedHts ? 100 : limit,
      orderBy: { issuedAt: "desc" },
    });

    if (!rawQuery && !normalizedHts) {
      return candidates.slice(0, limit);
    }

    const lowerRawQuery = rawQuery.toLowerCase();
    const htsHead4 = normalizedHts.slice(0, 4);
    const htsSub6 = normalizedHts.slice(0, 6);

    const scored = candidates.map((ruling) => {
      let score = 0;
      const lowerTitle = ruling.title.toLowerCase();

      // 1. Exact / phrase title match
      if (lowerRawQuery && lowerTitle.includes(lowerRawQuery)) {
        score += 50;
      }

      // 2. Title keyword term matches
      for (const token of tokens) {
        if (lowerTitle.includes(token)) {
          score += 15;
        }
      }

      // 3. HTS Reference Alignment
      for (const ref of ruling.htsReferences) {
        const refDigits = ref.htsNumberDisplay.replace(/[^0-9]/g, "");
        if (normalizedHts && refDigits === normalizedHts) {
          score += 40;
        } else if (htsSub6 && refDigits.startsWith(htsSub6)) {
          score += 25;
        } else if (htsHead4 && refDigits.startsWith(htsHead4)) {
          score += 10;
        }
      }

      // 4. Fragment text frequency and phrase match
      for (const fragment of ruling.fragments) {
        const lowerText = fragment.text.toLowerCase();
        if (lowerRawQuery && lowerText.includes(lowerRawQuery)) {
          score += 20;
        }

        let fragmentTokenMatches = 0;
        for (const token of tokens) {
          if (lowerText.includes(token)) {
            fragmentTokenMatches += 1;
          }
        }
        score += Math.min(fragmentTokenMatches * 5, 30);
      }

      // 5. Status & Recency adjustments
      if (ruling.modifiedOrRevokedStatus && ruling.modifiedOrRevokedStatus !== "EFFECTIVE") {
        score -= 20;
      }

      const yearsOld = (Date.now() - new Date(ruling.issuedAt).getTime()) / (365 * 24 * 3600 * 1000);
      const recencyBonus = Math.max(0, 10 - yearsOld);
      score += recencyBonus;

      return {
        ...ruling,
        relevanceScore: Math.round(score * 10) / 10,
      };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, limit);
  }

  /**
   * Index or seed a verified CBP CROSS ruling into the repository.
   */
  static async indexRuling(data: {
    rulingNumber: string;
    issuedAt: Date;
    title: string;
    office?: string;
    rulingType: string;
    sourceUrl?: string;
    htsCodes: string[];
    fragments: Array<{ fragmentType: string; text: string }>;
  }) {
    if (!RULING_TYPES.includes(data.rulingType as (typeof RULING_TYPES)[number])) {
      throw new Error(`rulingType must be one of: ${RULING_TYPES.join(", ")}`);
    }

    return db.ruling.upsert({
      where: { rulingNumber: data.rulingNumber },
      update: {
        title: data.title,
        office: data.office,
        issuedAt: data.issuedAt,
        sourceUrl: data.sourceUrl,
      },
      create: {
        rulingNumber: data.rulingNumber,
        issuedAt: data.issuedAt,
        title: data.title,
        office: data.office ?? null,
        rulingType: data.rulingType,
        sourceUrl: data.sourceUrl,
        htsReferences: {
          create: data.htsCodes.map((code) => ({
            htsNumberDisplay: code,
            relationType: "CLASSIFIED_AS",
          })),
        },
        fragments: {
          create: data.fragments.map((f) => ({
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
  }
}
