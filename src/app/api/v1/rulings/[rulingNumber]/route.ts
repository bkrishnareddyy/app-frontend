import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withPublicRoute<{ rulingNumber: string }>(async ({ params }) => {
  try {
    const { rulingNumber } = params;

    const ruling = await db.ruling.findUnique({
      where: { rulingNumber },
      include: {
        fragments: { orderBy: { id: "asc" } },
        htsReferences: true,
        fromRelations: {
          include: { toRuling: { select: { rulingNumber: true, title: true } } },
        },
      },
    });

    if (!ruling) {
      return NextResponse.json(
        { error: `Ruling '${rulingNumber}' not found in verified CBP CROSS database.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ ruling });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
