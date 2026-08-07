import { NextResponse } from "next/server";
import { HtsSearchService } from "@/modules/hts/htsSearchService";

export async function GET() {
  try {
    const currentRelease = await HtsSearchService.getCurrentRelease();
    if (!currentRelease) {
      return NextResponse.json({ error: "No active HTS release found" }, { status: 404 });
    }
    return NextResponse.json({ currentRelease });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch current release" }, { status: 500 });
  }
}
