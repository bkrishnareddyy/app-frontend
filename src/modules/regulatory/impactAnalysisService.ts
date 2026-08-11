import { db } from "@/lib/db";

export interface ImpactAnalysisOptions {
  accountId: string;
  oldReleaseId?: string;
  newReleaseId?: string;
}

export class ImpactAnalysisService {
  /**
   * Run portfolio impact analysis when an HTS release updates or tariff rates change.
   */
  static async analyzePortfolioImpact(options: ImpactAnalysisOptions) {
    // Find canonical products for account
    const products = await db.canonicalProduct.findMany({
      where: {
        accountId: options.accountId,
        htsCode: { not: null },
      },
      include: {
        aliases: true,
      },
    });

    // "The current rate" means the rate in the currently PUBLISHED release.
    // Resolved once, outside the loop: without the release filter this matched a
    // node from any ingested release, so the nightly USITC refresh staging a
    // DRAFT (which carries no duty rates) made every product look like its rate
    // had changed, and a SUPERSEDED release would have compared against a
    // schedule that no longer applies.
    const publishedRelease = await db.htsRelease.findFirst({
      where: { country: "US", publicationStatus: "PUBLISHED" },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true },
    });

    // Check for tariff changes in HtsChange table or match against active release nodes
    const impactedProducts = [];
    for (const product of products) {
      if (!product.htsCode) continue;

      const normCode = product.htsCode.replace(/[^0-9]/g, "");
      const node = publishedRelease
        ? await db.htsNode.findFirst({
            where: { releaseId: publishedRelease.id, htsNumberNormalized: normCode },
            include: { dutyRates: true },
          })
        : null;

      const currentGeneralRate = node?.dutyRates.find((r) => r.rateColumn === "General")?.rawRateText || null;
      const rateChanged = product.dutyRate !== null && currentGeneralRate !== null && product.dutyRate !== currentGeneralRate;

      if (rateChanged || !node) {
        impactedProducts.push({
          productId: product.id,
          canonicalName: product.canonicalName,
          sku: product.sku,
          htsCode: product.htsCode,
          previousDutyRate: product.dutyRate,
          newDutyRate: currentGeneralRate || "DISCONTINUED",
          impactLevel: rateChanged ? "DUTY_RATE_CHANGED" : "HTS_CODE_RECLASSIFIED",
        });
      }
    }

    return {
      accountId: options.accountId,
      totalPortfolioProducts: products.length,
      impactedCount: impactedProducts.length,
      impactedProducts,
      analyzedAt: new Date().toISOString(),
    };
  }
}
