import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { productActor } from "@/modules/product/productActor";
import { productIdParamSchema } from "@/modules/product/productSchemas";
import { setAttribute } from "@/modules/product/productService";
import type { DetectedChange } from "@/modules/product/productChangeDetection";

type Params = { id: string };

const approvedSuggestionSchema = z.object({
  attributeCode: z.string().min(1).max(64),
  attributeName: z.string().min(1).max(128),
  rawValue: z.string().min(1).max(2000),
  rawUnit: z.string().max(32).optional(),
  rationale: z.string().max(2000),
  confidence: z.number().min(0).max(100),
});

const approveBodySchema = z.object({
  approvedSuggestions: z.array(approvedSuggestionSchema).min(1).max(50),
});

export const POST = withAuthenticatedRoute<Params>(
  async ({ req, ctx, params, requestId }) => {
    const path = validatePathParams(params, productIdParamSchema, requestId);
    if ("response" in path) return path.response;

    const body = await parseAndValidateBody(req, approveBodySchema, requestId);
    if ("response" in body) return body.response;

    const productId = path.data.id;

    const product = await db.product.findFirst({
      where: { id: productId, accountId: ctx.accountId, deletedAt: null },
      select: { id: true, productName: true },
    });

    if (product === null) {
      return buildErrorResponse(404, "PRODUCT_NOT_FOUND", "No such product.", undefined, requestId);
    }

    // One evidence row anchors all approved suggestions from this enrichment run.
    const evidence = await db.productEvidence.create({
      data: {
        accountId: ctx.accountId,
        productId,
        sourceType: "AGENT",
        sourceReference: "claude-opus-5",
        description: `AI enrichment: ${body.data.approvedSuggestions.length} attribute(s) approved by user.`,
        createdByUserId: ctx.userId,
      },
    });

    const actor = productActor(ctx, requestId);
    const allChanges: DetectedChange[] = [];
    const allFlags: string[] = [];

    for (const suggestion of body.data.approvedSuggestions) {
      const outcome = await setAttribute(actor, productId, {
        attributeCode: suggestion.attributeCode,
        attributeName: suggestion.attributeName,
        rawValue: suggestion.rawValue,
        rawUnit: suggestion.rawUnit ?? null,
        sourceType: "AGENT",
        evidenceId: evidence.id,
      });

      allChanges.push(...(outcome.changes ?? []));
      allFlags.push(...(outcome.raisedFlags ?? []));
    }

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "product.enrich.approve",
      entity: "Product",
      entityId: productId,
      metadata: {
        productName: product.productName,
        applied: body.data.approvedSuggestions.length,
        evidenceId: evidence.id,
        attributeCodes: body.data.approvedSuggestions.map((s) => s.attributeCode),
      },
    });

    return NextResponse.json(
      {
        applied: body.data.approvedSuggestions.length,
        evidenceId: evidence.id,
        changes: allChanges,
        raisedFlags: allFlags,
        requestId,
      },
      { status: 201 }
    );
  },
  { permission: "products.edit", write: true }
);
