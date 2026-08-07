import { NextResponse } from "next/server";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(req.url);
    const asOfDate = searchParams.get("asOfDate") || undefined;

    const node = await HtsSearchService.getCodeDetail(code, asOfDate);
    if (!node) {
      return NextResponse.json({ error: `HTS code '${code}' not found` }, { status: 404 });
    }

    const notes = node.noteLinks.map((nl) => nl.fragment);
    return NextResponse.json({ htsCode: node.htsNumberDisplay, notes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch HTS legal notes" }, { status: 500 });
  }
}
