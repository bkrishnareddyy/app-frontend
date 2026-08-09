import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export const GET = withPublicRoute<{ code: string }>(async ({ req, params }) => {
  try {
    const { code } = params;
    const { searchParams } = new URL(req.url);
    const asOfDate = searchParams.get("asOfDate") || undefined;

    const node = await HtsSearchService.getCodeDetail(code, asOfDate);
    if (!node) {
      return NextResponse.json({ error: `HTS code '${code}' not found` }, { status: 404 });
    }

    return NextResponse.json({ htsCode: node.htsNumberDisplay, dutyRates: node.dutyRates });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
