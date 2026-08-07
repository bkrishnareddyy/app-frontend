import { NextResponse } from "next/server";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export async function GET() {
  try {
    const releases = await HtsSearchService.getReleases();
    return NextResponse.json({ releases });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch HTS releases" }, { status: 500 });
  }
}
