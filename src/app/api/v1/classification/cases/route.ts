import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { rawDescription, externalReference, priority, structuredAttributesJson, countryOfOrigin, intendedUse } = body;

    if (!rawDescription) {
      return NextResponse.json({ error: "rawDescription is required" }, { status: 400 });
    }

    const result = await ClassificationCaseEngine.createCase({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      rawDescription,
      externalReference,
      priority,
      structuredAttributesJson,
      countryOfOrigin,
      intendedUse,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create classification case" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const cases = await db.classificationCase.findMany({
      where: { accountId: ctx!.accountId },
      include: {
        subjects: true,
        documents: true,
        runs: { take: 1, orderBy: { startedAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({ cases });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch classification cases" }, { status: 500 });
  }
}
