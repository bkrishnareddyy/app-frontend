import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export const GET = withPublicRoute(async ({ req }) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || undefined;
    const asOfDate = searchParams.get("asOfDate") || undefined;
    const levelStr = searchParams.get("level");
    const chapter = searchParams.get("chapter") || undefined;
    const limitStr = searchParams.get("limit");
    const offsetStr = searchParams.get("offset");

    const level = levelStr ? parseInt(levelStr, 10) : undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const result = await HtsSearchService.search({
      q,
      asOfDate,
      level,
      chapter,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to search HTS Master" }, { status: 500 });
  }
});
