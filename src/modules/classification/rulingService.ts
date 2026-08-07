import { db } from "@/lib/db";

export interface RulingSearchOptions {
  htsCode?: string;
  query?: string;
  rulingNumber?: string;
  limit?: number;
}

export class RulingService {
  /**
   * Search CBP CROSS Rulings index by HTS code or search terms.
   */
  static async searchRulings(options: RulingSearchOptions) {
    const where: any = {};

    if (options.rulingNumber) {
      where.rulingNumber = { contains: options.rulingNumber, mode: "insensitive" };
    }

    if (options.query) {
      where.title = { contains: options.query, mode: "insensitive" };
    }

    if (options.htsCode) {
      const normalized = options.htsCode.replace(/[^0-9]/g, "");
      where.htsReferences = {
        some: {
          htsNumberDisplay: { contains: normalized },
        },
      };
    }

    return db.ruling.findMany({
      where,
      include: {
        fragments: true,
        htsReferences: true,
      },
      take: options.limit || 5,
      orderBy: { issuedAt: "desc" },
    });
  }

  /**
   * Index or seed a verified CBP CROSS ruling into the repository.
   */
  static async indexRuling(data: {
    rulingNumber: string;
    issuedAt: Date;
    title: string;
    office?: string;
    rulingType?: string;
    sourceUrl?: string;
    htsCodes: string[];
    fragments: Array<{ fragmentType: string; text: string }>;
  }) {
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
        office: data.office || "HQ",
        rulingType: data.rulingType || "HQ",
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
