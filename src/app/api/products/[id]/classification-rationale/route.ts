import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

async function findClassificationCase(accountId: string, canonicalProductId: string) {
  return db.classificationCase.findFirst({
    where: {
      accountId,
      subjects: { some: { canonicalProductId } },
    },
    include: {
      subjects: true,
      decisions: {
        where: { decisionStatus: "APPROVED" },
        include: { approvedNode: true },
        orderBy: { attestedAt: "desc" },
        take: 1,
      },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
        include: {
          proposals: {
            orderBy: { rank: "asc" },
            take: 3,
            include: {
              griSteps: { orderBy: { sequence: "asc" } },
              evidenceItems: { orderBy: { relevanceScore: "desc" } },
              proposedNode: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * GET /api/products/[id]/classification-rationale
 *
 * Returns the complete classification rationale for a product's current approved
 * classification: the ProductClassification record, its evidence, the linked
 * ClassificationCase (if any), all GRI analysis steps, ruling citations, and the
 * approving decision. This is the institutional knowledge record for the product.
 */
export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, params, requestId }) => {
  const { id } = params;

  const product = await db.product.findFirst({
    where: { id, accountId: ctx.accountId },
    select: {
      id: true,
      productName: true,
      customsDescription: true,
      commercialDescription: true,
      classifications: {
        where: { status: "APPROVED", accountId: ctx.accountId },
        include: { evidence: true },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const approvedClassification = product.classifications[0] ?? null;

  // Find the CanonicalProduct entry pointing at this product (legacy bridge table).
  const canonicalProduct = await db.canonicalProduct.findFirst({
    where: { accountId: ctx.accountId, productId: id },
    select: { id: true },
  });

  const classificationCase = canonicalProduct
    ? await findClassificationCase(ctx.accountId, canonicalProduct.id)
    : null;

  const latestRun = classificationCase?.runs[0] ?? null;
  const topProposal = latestRun?.proposals[0] ?? null;

  return NextResponse.json({
    product: {
      id: product.id,
      name: product.productName,
      description: product.customsDescription ?? product.commercialDescription ?? null,
    },
    approvedClassification: approvedClassification
      ? {
          id: approvedClassification.id,
          jurisdiction: approvedClassification.jurisdiction,
          nomenclature: approvedClassification.nomenclature,
          classificationCode: approvedClassification.classificationCode,
          description: approvedClassification.description,
          decisionSource: approvedClassification.decisionSource,
          decisionMethod: approvedClassification.decisionMethod,
          effectiveFrom: approvedClassification.effectiveFrom.toISOString(),
          effectiveTo: approvedClassification.effectiveTo?.toISOString() ?? null,
          reviewNote: approvedClassification.reviewNote,
          reviewedAt: approvedClassification.reviewedAt?.toISOString() ?? null,
          evidence: approvedClassification.evidence
            ? {
                id: approvedClassification.evidence.id,
                type: approvedClassification.evidence.sourceType,
                summary: approvedClassification.evidence.description,
              }
            : null,
        }
      : null,
    classificationCase: classificationCase
      ? {
          id: classificationCase.id,
          status: classificationCase.status,
          jurisdiction: classificationCase.jurisdiction,
          approvedDecision: classificationCase.decisions[0]
            ? {
                rationale: classificationCase.decisions[0].rationale,
                overrideReason: classificationCase.decisions[0].overrideReason,
                attestedAt: classificationCase.decisions[0].attestedAt.toISOString(),
                approvedHtsCode: classificationCase.decisions[0].approvedNode.htsNumberDisplay,
                approvedHtsDescription: classificationCase.decisions[0].approvedNode.description,
              }
            : null,
          latestProposal: topProposal
            ? {
                htsCode: topProposal.proposedNode.htsNumberDisplay,
                description: topProposal.proposedNode.description,
                calibratedConfidence: topProposal.calibratedConfidence,
                confidenceBand: topProposal.confidenceBand,
                summary: topProposal.summary,
                griSteps: topProposal.griSteps.map((s) => ({
                  sequence: s.sequence,
                  griRule: s.griRule,
                  question: s.question,
                  conclusion: s.conclusion,
                  outcome: s.outcome,
                })),
                evidenceItems: topProposal.evidenceItems.map((e) => ({
                  evidenceType: e.evidenceType,
                  citation: e.citation,
                  quotedFragment: e.quotedFragment,
                  relevanceScore: e.relevanceScore,
                  supportsOrConflicts: e.supportsOrConflicts,
                })),
              }
            : null,
        }
      : null,
    requestId,
  });
});
