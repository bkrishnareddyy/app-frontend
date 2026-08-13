import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { normalizeClassificationCode } from "@/modules/product/productNormalization";

export interface CreateCanonicalProductInput {
  accountId: string;
  userId: string;
  canonicalName: string;
  sku?: string;
  partNumber?: string;
  manufacturer?: string;
  countryOfOrigin?: string;
  htsCode?: string;
  dutyRate?: string;
  aliases?: string[];
}

export interface BindClassificationInput {
  accountId: string;
  userId: string;
  canonicalProductId: string;
  decisionId: string;
}

export class ProductMasterService {
  static async createCanonicalProduct(input: CreateCanonicalProductInput) {
    const product = await db.canonicalProduct.create({
      data: {
        accountId: input.accountId,
        canonicalName: input.canonicalName,
        sku: input.sku || null,
        partNumber: input.partNumber || null,
        manufacturer: input.manufacturer || null,
        countryOfOrigin: input.countryOfOrigin || null,
        htsCode: input.htsCode || null,
        dutyRate: input.dutyRate || null,
        aliases: {
          create: (input.aliases || []).map((alias) => ({
            aliasName: alias,
            source: "Manual Entry",
            matchConfidence: 100,
          })),
        },
      },
      include: { aliases: true },
    });

    await createAuditLog({
      accountId: input.accountId,
      userId: input.userId,
      action: AuditAction.PRODUCT_CREATED,
      entity: "CanonicalProduct",
      entityId: product.id,
      source: "UI",
      metadata: { canonicalName: input.canonicalName, sku: input.sku },
    });

    return product;
  }

  /**
   * Binds an approved ClassificationDecision to a CanonicalProduct.
   *
   * Updates the CanonicalProduct with the approved HTS code and duty rate.
   * If the CanonicalProduct is linked to a Product (productId != null), also
   * creates or updates a ProductClassification row so the two systems stay in
   * sync. The classification lands APPROVED with effectiveFrom = now, because
   * a human already approved it in the classification workflow.
   */
  static async bindClassification(input: BindClassificationInput) {
    const decision = await db.classificationDecision.findUnique({
      where: { id: input.decisionId },
      include: {
        approvedNode: { include: { dutyRates: true } },
        case: true,
      },
    });

    if (!decision) {
      throw new Error(`ClassificationDecision '${input.decisionId}' not found.`);
    }

    const canonicalProduct = await db.canonicalProduct.findFirst({
      where: { id: input.canonicalProductId, accountId: input.accountId },
    });

    if (!canonicalProduct) {
      throw new Error(`CanonicalProduct '${input.canonicalProductId}' not found for account.`);
    }

    const generalRate =
      decision.approvedNode.dutyRates.find((r) => r.rateColumn === "General")?.rawRateText ?? null;

    const htsCode = decision.approvedNode.htsNumberDisplay;
    const effectiveDate = decision.effectiveFrom ?? new Date();
    const jurisdiction = decision.case.jurisdiction ?? "US";

    const updatedProduct = await db.$transaction(async (tx) => {
      const cp = await tx.canonicalProduct.update({
        where: { id: input.canonicalProductId },
        data: { htsCode, dutyRate: generalRate, updatedAt: new Date() },
        include: { aliases: true },
      });

      // If this CanonicalProduct is linked to the new Product master, keep the
      // ProductClassification in sync so downstream systems read from one source.
      if (cp.productId !== null) {
        const normalizedCode = normalizeClassificationCode(htsCode);

        // Supersede any existing approved classification for this jurisdiction
        await tx.productClassification.updateMany({
          where: {
            productId: cp.productId,
            accountId: input.accountId,
            jurisdiction,
            status: "APPROVED",
          },
          data: { status: "SUPERSEDED", effectiveTo: effectiveDate },
        });

        await tx.productClassification.create({
          data: {
            accountId: input.accountId,
            productId: cp.productId,
            jurisdiction,
            nomenclature: jurisdiction === "US" ? "HTSUS" : "HS",
            classificationCode: htsCode,
            normalizedCode,
            description: null,
            status: "APPROVED",
            decisionSource: "USER",
            decisionMethod: "RULING_BASED",
            effectiveFrom: effectiveDate,
            createdByUserId: input.userId,
            reviewedByUserId: input.userId,
            reviewedAt: new Date(),
          },
        });
      }

      return cp;
    });

    await createAuditLog({
      accountId: input.accountId,
      userId: input.userId,
      action: AuditAction.PRODUCT_CLASSIFIED,
      entity: "CanonicalProduct",
      entityId: canonicalProduct.id,
      source: "UI",
      metadata: {
        decisionId: input.decisionId,
        approvedHtsCode: htsCode,
        dutyRate: generalRate,
        effectiveFrom: effectiveDate.toISOString(),
        jurisdiction,
        linkedProductId: canonicalProduct.productId,
      },
    });

    return updatedProduct;
  }
}
