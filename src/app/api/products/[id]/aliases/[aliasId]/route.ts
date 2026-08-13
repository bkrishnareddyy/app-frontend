import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

type Params = { id: string; aliasId: string };

const paramsSchema = z.object({
  id: z.string().min(1),
  aliasId: z.string().min(1),
});

export const DELETE = withAuthenticatedRoute<Params>(
  async ({ ctx, params, requestId }) => {
    const path = validatePathParams(params, paramsSchema, requestId);
    if ("response" in path) return path.response;

    const alias = await db.productAlias.findFirst({
      where: {
        id: path.data.aliasId,
        canonicalProduct: { productId: path.data.id, accountId: ctx.accountId },
      },
      select: { id: true, aliasName: true, canonicalProductId: true },
    });

    if (alias === null) {
      return buildErrorResponse(404, "ALIAS_NOT_FOUND", "No such alias on this product.", undefined, requestId);
    }

    await db.productAlias.delete({ where: { id: alias.id } });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "product.alias.delete",
      entity: "ProductAlias",
      entityId: alias.id,
      metadata: { productId: path.data.id, canonicalProductId: alias.canonicalProductId, aliasName: alias.aliasName },
    });

    return NextResponse.json({ deleted: true, requestId });
  },
  { permission: "products.edit", write: true }
);
