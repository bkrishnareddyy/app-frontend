/**
 * Product master tools.
 *
 * Every one of these calls the same `productService` functions the Products
 * screens call, through a `ProductActor` built from the session. The tenant
 * filter is inside those services, not here, and there is no parameter on any
 * tool that could reach it.
 *
 * `getProduct` deserves a note. It does not hand the model the raw product
 * record. It hands it a projection in which the country-of-origin question is
 * already answered by `resolveOriginPosition`, so the most consequential fact
 * on a product is decided in code and quoted, never inferred from the German
 * address of a supplier.
 */

import { COPILOT_LIMITS } from "../copilotConfig";
import { capped, isoDate, isoDay, numeric, text } from "../copilotProjection";
import { resolveOriginPosition } from "../copilotOrigin";
import { defineTool, type CopilotToolRunContext } from "../copilotToolTypes";
import { booleanParam, integerParam, params, stringParam } from "../copilotToolSchema";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getProduct,
  getProductHistory,
  listProducts,
  type ProductActor,
} from "@/modules/product/productService";
import { parseProductQuery } from "@/modules/product/productQuery";
import { holdsPermission } from "@/modules/product/productActor";

const PRODUCTS_NAV = "/app/products";

/**
 * Built from the session context every time, never cached and never assembled
 * from tool arguments. `canApproveClassification` is carried because the
 * services expect it, not because any Copilot tool approves anything.
 */
function actorFor(ctx: CopilotToolRunContext): ProductActor {
  return {
    accountId: ctx.actor.accountId,
    userId: ctx.actor.userId,
    canApproveClassification: holdsPermission(
      ctx.actor.context,
      "products.classification.approve"
    ),
    requestId: ctx.actor.requestId,
  };
}

const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "ARCHIVED"] as const;
const PRODUCT_REVIEW_STATUSES = [
  "UNREVIEWED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "NEEDS_REVIEW",
] as const;

const searchInput = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  reviewStatus: z.enum(PRODUCT_REVIEW_STATUSES).optional(),
  unclassified: z.boolean().optional(),
  needsRevalidation: z.boolean().optional(),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const searchProductsTool = defineTool<z.infer<typeof searchInput>>({
  name: "searchProducts",
  description:
    "Search the Global Product Master for products in the signed-in account. Returns a bounded list of summaries. Use it to find a product id before asking for detail.",
  progressLabel: "Searching products",
  access: { navHref: PRODUCTS_NAV },
  input: searchInput,
  parameters: params({
    query: stringParam("Free text: product name, SKU, brand, model, or a classification code prefix."),
    status: stringParam("Product lifecycle status.", { values: PRODUCT_STATUSES }),
    reviewStatus: stringParam("Master-data review status.", { values: PRODUCT_REVIEW_STATUSES }),
    unclassified: booleanParam("Only products with no approved classification."),
    needsRevalidation: booleanParam("Only products carrying an open revalidation flag."),
    limit: integerParam("Maximum rows to return.", { min: 1, max: COPILOT_LIMITS.maxSearchResults }),
  }),

  async execute(ctx, input) {
    const limit = input.limit ?? COPILOT_LIMITS.maxSearchResults;
    const search = new URLSearchParams();
    if (input.query) search.set("q", input.query);
    if (input.status) search.set("status", input.status);
    if (input.reviewStatus) search.set("reviewStatus", input.reviewStatus);
    if (input.unclassified) search.set("unclassified", "true");
    if (input.needsRevalidation) search.set("needsRevalidation", "true");
    search.set("pageSize", String(limit));

    const result = await listProducts(actorFor(ctx), parseProductQuery(search));

    const products = result.rows.map((row) => {
      const label = row.internalSku ? `${row.productName} (${row.internalSku})` : row.productName;
      ctx.ledger.recordEntity("PRODUCT", row.id, label);
      return {
        productId: row.id,
        name: row.productName,
        sku: row.internalSku,
        brand: row.brand,
        model: row.model,
        status: row.status,
        reviewStatus: row.reviewStatus,
        approvedClassificationJurisdictions: row.approvedJurisdictions,
        pendingClassificationCount: row.pendingClassificationCount,
        openRevalidationCount: row.openRevalidationCount,
        updatedAt: isoDay(row.updatedAt),
      };
    });

    return {
      ok: true,
      data: {
        totalMatching: result.total,
        returned: products.length,
        truncated: result.total > products.length,
        products,
      },
    };
  },
});

const productIdInput = z.object({ productId: z.string().trim().min(1).max(64) });

export const getProductTool = defineTool<z.infer<typeof productIdInput>>({
  name: "getProduct",
  description:
    "Full detail for one product: identifiers, descriptions, classifications, country facts, parties, attributes, open revalidation flags, and Qubere's country-of-origin position. Requires a product id from searchProducts or from the page the user is on.",
  progressLabel: "Reading product record",
  access: { navHref: PRODUCTS_NAV },
  input: productIdInput,
  parameters: params(
    { productId: stringParam("The Qubere product id.") },
    ["productId"]
  ),

  async execute(ctx, input) {
    const product = await getProduct(actorFor(ctx), input.productId);
    if (!product) {
      return { ok: false, code: "NOT_FOUND", message: "No such product in this account." };
    }

    const label = product.internalSku
      ? `${product.productName} (${product.internalSku})`
      : product.productName;
    ctx.ledger.recordEntity("PRODUCT", product.id, label);

    for (const item of product.evidence.slice(0, COPILOT_LIMITS.maxSearchResults)) {
      ctx.ledger.recordEvidence(
        item.id,
        `${item.sourceType} evidence on ${product.productName}`,
        text(item.description, 160),
        { type: "PRODUCT", id: product.id }
      );
    }

    // Decided here, in code, from the fact types the schema already separates.
    const origin = resolveOriginPosition(product.countryFacts);

    const classifications = capped(
      product.classifications,
      COPILOT_LIMITS.maxSearchResults,
      (row) => ({
        jurisdiction: row.jurisdiction,
        nomenclature: row.nomenclature,
        code: row.classificationCode,
        description: text(row.description, 160),
        status: row.status,
        method: row.decisionMethod,
        reviewedAt: isoDay(row.reviewedAt),
        effectiveFrom: isoDay(row.effectiveFrom),
        effectiveTo: isoDay(row.effectiveTo),
        evidenceId: row.evidenceId,
      })
    );

    const approved = product.classifications.filter((c) => c.status === "APPROVED");

    return {
      ok: true,
      data: {
        productId: product.id,
        name: product.productName,
        sku: product.internalSku,
        brand: product.brand,
        model: product.model,
        status: product.status,
        reviewStatus: product.reviewStatus,
        version: product.currentVersion,
        commercialDescription: text(product.commercialDescription, 400),
        technicalDescription: text(product.technicalDescription, 400),
        customsDescription: text(product.customsDescription, 400),
        identifiers: product.identifiers.slice(0, 10).map((row) => ({
          type: row.identifierType,
          value: row.value,
          isPrimary: row.isPrimary,
        })),
        classifications: classifications.items,
        classificationsTruncated: classifications.truncated,
        hasApprovedClassification: approved.length > 0,
        countryOfOrigin: {
          legalCountryOfOrigin: origin.legalCountryOfOrigin,
          basis: origin.basis,
          // Quote this. Do not restate it.
          statement: origin.statement,
          manufactureCountries: origin.manufactureCountries,
          productionCountries: origin.productionCountries,
          unverifiedOriginClaims: origin.unverifiedOriginClaims,
        },
        parties: product.parties.slice(0, 10).map((row) => ({
          role: row.role,
          name: row.legalEntity.legalName,
          country: row.legalEntity.country,
          manufacturingSite: text(row.manufacturingSite, 120),
          status: row.status,
        })),
        attributes: product.attributes.slice(0, 15).map((row) => ({
          code: row.attributeCode,
          value: text(row.normalizedValue ?? row.rawValue, 120),
          unit: row.normalizedUnit ?? row.rawUnit,
          status: row.status,
        })),
        compositions: product.compositions.slice(0, 10).map((row) => ({
          material: row.material,
          percentage: numeric(row.percentage),
          status: row.status,
        })),
        openRevalidationFlags: product.revalidationFlags
          .filter((flag) => flag.status === "OPEN")
          .slice(0, 10)
          .map((flag) => ({
            flag: flag.flag,
            reason: text(flag.reason, 200),
            raisedAt: isoDay(flag.createdAt),
          })),
        evidenceCount: product.evidence.length,
        updatedAt: isoDate(product.updatedAt),
      },
    };
  },
});

const historyInput = z.object({
  productId: z.string().trim().min(1).max(64),
  limit: z.number().int().min(1).max(COPILOT_LIMITS.maxSearchResults).optional(),
});

export const getProductHistoryTool = defineTool<z.infer<typeof historyInput>>({
  name: "getProductHistory",
  description:
    "Recorded change history for one product: what changed, when, by which version, and how customs-significant it was. Use it for 'what changed' and 'why is this flagged' questions.",
  progressLabel: "Reading product history",
  access: { navHref: PRODUCTS_NAV },
  input: historyInput,
  parameters: params(
    {
      productId: stringParam("The Qubere product id."),
      limit: integerParam("Maximum change events to return, newest first.", {
        min: 1,
        max: COPILOT_LIMITS.maxSearchResults,
      }),
    },
    ["productId"]
  ),

  async execute(ctx, input) {
    const actor = actorFor(ctx);
    const product = await getProduct(actor, input.productId);
    if (!product) {
      return { ok: false, code: "NOT_FOUND", message: "No such product in this account." };
    }

    const events = await getProductHistory(actor, input.productId);
    const limit = input.limit ?? COPILOT_LIMITS.maxSearchResults;
    const page = capped(events, limit, (event) => ({
      changedAt: isoDate(event.createdAt),
      version: event.versionNumber,
      entity: event.entity,
      field: event.field,
      significance: event.significance,
      impactFlags: event.impactFlags,
      previousValue: text(event.oldValue, 120),
      newValue: text(event.newValue, 120),
      reason: text(event.changeReason, 300),
    }));

    ctx.ledger.recordEntity("PRODUCT", product.id, product.productName);

    return {
      ok: true,
      data: {
        productId: product.id,
        totalEvents: events.length,
        returned: page.returned,
        truncated: page.truncated,
        events: page.items,
      },
    };
  },
});

export const getProductEvidenceTool = defineTool<z.infer<typeof productIdInput>>({
  name: "getProductEvidence",
  description:
    "The provenance behind a product's facts: which document, page and extraction each fact came from, and which facts each evidence record supports. Use it whenever the user asks how Qubere knows something about a product.",
  progressLabel: "Reading product evidence",
  access: { navHref: PRODUCTS_NAV },
  input: productIdInput,
  parameters: params({ productId: stringParam("The Qubere product id.") }, ["productId"]),

  async execute(ctx, input) {
    const accountId = ctx.actor.accountId;

    // Ownership is proved by this read, not by the argument.
    const product = await db.product.findFirst({
      where: { id: input.productId, accountId, deletedAt: null },
      select: { id: true, productName: true },
    });
    if (!product) {
      return { ok: false, code: "NOT_FOUND", message: "No such product in this account." };
    }

    ctx.ledger.recordEntity("PRODUCT", product.id, product.productName);

    const [rows, total] = await Promise.all([
      db.productEvidence.findMany({
        where: { productId: product.id, accountId },
        orderBy: { createdAt: "desc" },
        take: COPILOT_LIMITS.maxSearchResults,
        include: {
          sourceDocument: { select: { id: true, fileName: true, docType: true } },
          _count: {
            select: {
              attributes: true,
              compositions: true,
              parties: true,
              countryFacts: true,
              classifications: true,
            },
          },
        },
      }),
      db.productEvidence.count({ where: { productId: product.id, accountId } }),
    ]);

    const evidence = rows.map((item) => {
      const document = item.sourceDocument;
      const label = document
        ? `${document.fileName}${item.page ? `, page ${item.page}` : ""}`
        : `${item.sourceType} evidence`;

      ctx.ledger.recordEvidence(item.id, label, text(item.description, 160), {
        type: "PRODUCT",
        id: product.id,
      });
      if (document) ctx.ledger.recordEntity("DOCUMENT", document.id, document.fileName);

      return {
        evidenceId: item.id,
        sourceType: item.sourceType,
        documentId: document?.id ?? null,
        documentName: document?.fileName ?? null,
        documentType: document?.docType ?? null,
        page: item.page,
        reference: text(item.sourceReference, 120),
        description: text(item.description, 240),
        supports: {
          attributes: item._count.attributes,
          compositions: item._count.compositions,
          parties: item._count.parties,
          countryFacts: item._count.countryFacts,
          classifications: item._count.classifications,
        },
        recordedAt: isoDay(item.createdAt),
      };
    });

    return {
      ok: true,
      data: {
        productId: product.id,
        totalEvidence: total,
        returned: evidence.length,
        truncated: total > evidence.length,
        evidence,
      },
    };
  },
});

export const productTools = [
  searchProductsTool,
  getProductTool,
  getProductHistoryTool,
  getProductEvidenceTool,
];
