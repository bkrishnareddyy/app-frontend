import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { productIdParamSchema } from "@/modules/product/productSchemas";

type Params = { id: string };

const createAliasBodySchema = z.object({
  canonicalProductId: z.string().min(1),
  aliasName: z.string().min(1).max(512),
  source: z.string().max(128).optional(),
});

export const GET = withAuthenticatedRoute<Params>(async ({ ctx, params, requestId }) => {
  const path = validatePathParams(params, productIdParamSchema, requestId);
  if ("response" in path) return path.response;

  const exists = await db.product.findFirst({
    where: { id: path.data.id, accountId: ctx.accountId, deletedAt: null },
    select: { id: true },
  });

  if (exists === null) {
    return buildErrorResponse(404, "PRODUCT_NOT_FOUND", "No such product.", undefined, requestId);
  }

  const canonicalProducts = await db.canonicalProduct.findMany({
    where: { productId: path.data.id, accountId: ctx.accountId },
    select: {
      id: true,
      canonicalName: true,
      sku: true,
      aliases: {
        select: { id: true, aliasName: true, source: true, matchConfidence: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ canonicalProducts, requestId });
});

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, createAliasBodySchema, requestId);
    if ("response" in body) return body.response;

    const canonicalProduct = await db.canonicalProduct.findFirst({
      where: {
        id: body.data.canonicalProductId,
        productId: path.data.id,
        accountId: ctx.accountId,
      },
      select: { id: true },
});

    if (canonicalProduct === null) {
      return buildErrorResponse(
        404,
        "CANONICAL_PRODUCT_NOT_FOUND",
        "No such canonical product linked to this product.",
        undefined,
        requestId
      );
    }

    const duplicate = await db.productAlias.findFirst({
      where: { canonicalProductId: body.data.canonicalProductId, aliasName: body.data.aliasName },
      select: { id: true },
    });

    if (duplicate !== null) {
      return buildErrorResponse(
        409,
        "ALIAS_ALREADY_EXISTS",
        "This alias already exists on this canonical product.",
        undefined,
        requestId
      );
    }

    const alias = await db.productAlias.create({
      data: {
        canonicalProductId: body.data.canonicalProductId,
        aliasName: body.data.aliasName,
        source: body.data.source ?? "User Entry",
        matchConfidence: 100,
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "product.alias.create",
      entity: "ProductAlias",
      entityId: alias.id,
      metadata: { productId: path.data.id, canonicalProductId: body.data.canonicalProductId, aliasName: body.data.aliasName },
    });

    return NextResponse.json({ alias, requestId });
  
}, { permission: "products.edit", write: true });
