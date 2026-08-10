import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { RulingService } from "@/modules/classification/rulingService";

export const GET = withPublicRoute(async ({ req }) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query") || searchParams.get("q") || undefined;
    const htsCode = searchParams.get("htsCode") || undefined;
    const rulingNumber = searchParams.get("rulingNumber") || undefined;
    const limitStr = searchParams.get("limit");

    const limit = limitStr ? parseInt(limitStr, 10) : 10;

    const rulings = await RulingService.searchRulings({
      query,
      htsCode,
      rulingNumber,
      limit,
    });

    return NextResponse.json({ rulings });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
