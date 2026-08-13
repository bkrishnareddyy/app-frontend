import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";
import { db } from "@/lib/db";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  try {
    const body = await req.json();

    // Accept both new spec shape {description, attributes, productId?} and old shape {rawDescription, ...}
    const rawDescription: string = body.description ?? body.rawDescription;
    const attributes: Record<string, string> = body.attributes ?? body.structuredAttributesJson ?? {};
    const { productId, lineItemId, externalReference, priority, countryOfOrigin, intendedUse } = body;

    if (!rawDescription) {
      return NextResponse.json({ error: "description is required" });
    }

    const result = await ClassificationCaseEngine.createCase({
      accountId: ctx.accountId,
      userId: ctx.userId,
      rawDescription,
      productId,
      lineItemId,
      externalReference,
      priority,
      structuredAttributesJson: attributes,
      countryOfOrigin,
      intendedUse,
});

    const statusCode = result.isExisting ? 200 : 201;
    return NextResponse.json(result, { status: statusCode });
  } catch (error: unknown) {
    return handleApiError(error);
  }

}, { permission: "classification.create", write: true });

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  try {
    const { searchParams } = new URL(req.url);
    const productIdsParam = searchParams.getAll("productIds[]");
    const status = searchParams.get("status") ?? undefined;

    const cases = await db.classificationCase.findMany({
      where: {
        accountId: ctx.accountId,
        status: status || undefined,
      },
      include: {
        subjects: true,
        documents: true,
        runs: { take: 1, orderBy: { startedAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ cases });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
