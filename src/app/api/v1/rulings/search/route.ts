import { NextResponse } from "next/server";
import { RulingService } from "@/modules/classification/rulingService";

export async function GET(req: Request) {
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
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to search CBP CROSS rulings" }, { status: 500 });
  }
}
