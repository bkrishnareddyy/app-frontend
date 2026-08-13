import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";
import { applyAutoApprovalPolicy } from "@/modules/decisions/autoApprovalPolicy";

const MAX_BATCH = 100;

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  try {
    const body = await req.json();
    const { productIds } = body as { productIds?: string[] };

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: "productIds array is required" }, { status: 400 });
    }

    if (productIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH} products per batch request` },
        { status: 422 }
      );
    }

    const queued: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const productId of productIds) {
      try {
        // Check if product has an existing approved classification
        const approvedClassification = await db.productClassification.findFirst({
          where: { productId, accountId: ctx.accountId, status: "APPROVED" },
          select: { id: true },
        });

        if (approvedClassification) {
          skipped.push(productId);
          continue;
        }

        // Get product description for classification
        const product = await db.product.findFirst({
          where: { id: productId, accountId: ctx.accountId },
          select: { productName: true, customsDescription: true, technicalDescription: true },
        });

        if (!product) {
          errors.push(productId);
          continue;
        }

        const description =
          product.customsDescription || product.technicalDescription || product.productName;

        const caseResult = await ClassificationCaseEngine.createCase({
          accountId: ctx.accountId,
          userId: ctx.userId,
          rawDescription: description,
          productId,
          priority: "MEDIUM",
        });

        if (!caseResult.isExisting) {
          // D-2: trigger run and apply auto-approval routing
          const runResult = await ClassificationCaseEngine.triggerRun(
            ctx.accountId,
            ctx.userId,
            caseResult.classificationCase.id
          );

          // Route based on policy after processing completes
          // The triggerRun fires processing in background; policy applied when proposal confidence is known
          void runResult;

          // Apply routing policy for immediate status update
          const policy = applyAutoApprovalPolicy({
            confidence: null, // not known yet; worker will update
            partMasterMatch: false,
            partMasterHtsAgrees: false,
            agentName: "batch-classification",
          });

          if (policy.outcome === "REVIEW") {
            await db.classificationCase.update({
              where: { id: caseResult.classificationCase.id },
              data: { status: "HUMAN_REVIEW_REQUIRED" },
            });
          }
        }

        queued.push(productId);
      } catch {
        errors.push(productId);
      }
    }

    return NextResponse.json({ queued, skipped, errors }, { status: 202 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}, { write: true });
