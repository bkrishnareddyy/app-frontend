import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withPublicRoute<{ releaseId: string }>(async ({ params }) => {
  try {
    const { releaseId } = params;
    const release = await db.htsRelease.findUnique({
      where: { id: releaseId },
      include: {
        _count: {
          select: { nodes: true, legalDocuments: true },
        },
      },
    });

    if (!release) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    return NextResponse.json({ release });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
