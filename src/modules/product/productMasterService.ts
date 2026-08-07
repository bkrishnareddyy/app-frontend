import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

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
  /**
   * Create a new canonical product in Enterprise Product Master.
   */
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
      include: {
        aliases: true,
      },
    });

    await createAuditLog({
      accountId: input.accountId,
      userId: input.userId,
      action: "product.canonical.create",
      entity: "CanonicalProduct",
      entityId: product.id,
      metadata: { canonicalName: input.canonicalName, sku: input.sku },
    });

    return product;
  }

  /**
   * Bind an approved ClassificationDecision to a CanonicalProduct.
   */
  static async bindClassification(input: BindClassificationInput) {
    const decision = await db.classificationDecision.findUnique({
      where: { id: input.decisionId },
      include: { approvedNode: { include: { dutyRates: true } } },
    });

    if (!decision) {
      throw new Error(`ClassificationDecision '${input.decisionId}' not found.`);
    }

    const product = await db.canonicalProduct.findFirst({
      where: { id: input.canonicalProductId, accountId: input.accountId },
    });

    if (!product) {
      throw new Error(`CanonicalProduct '${input.canonicalProductId}' not found for account.`);
    }

    const generalRate = decision.approvedNode.dutyRates.find((r) => r.rateColumn === "General")?.rawRateText || null;

    const updatedProduct = await db.canonicalProduct.update({
      where: { id: input.canonicalProductId },
      data: {
        htsCode: decision.approvedNode.htsNumberDisplay,
        dutyRate: generalRate,
        updatedAt: new Date(),
      },
      include: { aliases: true },
    });

    await createAuditLog({
      accountId: input.accountId,
      userId: input.userId,
      action: "product.canonical.bind_classification",
      entity: "CanonicalProduct",
      entityId: product.id,
      metadata: {
        decisionId: input.decisionId,
        approvedHtsCode: decision.approvedNode.htsNumberDisplay,
        dutyRate: generalRate,
      },
    });

    return updatedProduct;
  }
}
