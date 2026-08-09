import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export const GET = withPublicRoute(async () => {
  try {
    const releases = await HtsSearchService.getReleases();
    return NextResponse.json({ releases });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
