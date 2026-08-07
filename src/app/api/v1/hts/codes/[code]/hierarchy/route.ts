import { NextResponse } from "next/server";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(req.url);
    const asOfDate = searchParams.get("asOfDate") || undefined;

    const hierarchy = await HtsSearchService.getHierarchy(code, asOfDate);
    return NextResponse.json({ hierarchy });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch HTS code hierarchy" }, { status: 500 });
  }
}
