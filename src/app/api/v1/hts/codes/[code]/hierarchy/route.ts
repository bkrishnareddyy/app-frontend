import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export const GET = withPublicRoute<{ code: string }>(async ({ req, params }) => {
  try {
    const { code } = params;
    const { searchParams } = new URL(req.url);
    const asOfDate = searchParams.get("asOfDate") || undefined;

    const hierarchy = await HtsSearchService.getHierarchy(code, asOfDate);
    return NextResponse.json({ hierarchy });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
