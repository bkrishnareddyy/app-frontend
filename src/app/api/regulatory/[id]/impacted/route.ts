import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { computeRegulatoryImpact } from "@/lib/regulatory/impactAnalysis";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  // Pagination query params
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.max(1, parseInt(searchParams.get("limit") || "10"));
  const skip = (page - 1) * limit;

  const update = await db.regulatoryUpdate.findUnique({
    where: { id },
  });

  if (!update) {
    return NextResponse.json({ error: "Regulatory Update not found" }, { status: 404 });
  }

  const metadata = (update.metadata as any) || {};
  const affectedHtsCodes = metadata.affectedHtsCodes || [];

  const result = await computeRegulatoryImpact(ctx.accountId, affectedHtsCodes);

  // Apply simple page slice to products and shipments lists
  const paginatedProducts = result.products.slice(skip, skip + limit);
  const paginatedShipments = result.shipments.slice(skip, skip + limit);

  return NextResponse.json({
    updateTitle: update.title,
    affectedHtsCodes,
    products: paginatedProducts,
    shipments: paginatedShipments,
    lots: result.lots,
    pagination: {
      page,
      limit,
      totalProducts: result.products.length,
      totalShipments: result.shipments.length,
    },
  });
});
