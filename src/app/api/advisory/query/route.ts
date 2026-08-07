import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { query } = body;

    if (!ctx.permissions.includes("intel.read") && ctx.roleName !== "OWNER" && !ctx.isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden: Missing intel.read capability" }, { status: 403 });
    }

    if (!query) {
      return NextResponse.json({ error: "Query prompt is required" }, { status: 400 });
    }

    const updates = await db.regulatoryUpdate.findMany({ take: 3 });

    const responseAnswer = `Based on current U.S. International Trade Commission (USITC) and CBP regulations:
- ${query.toLowerCase().includes("china") || query.toLowerCase().includes("301") ? "Section 301 tariffs apply an additional 7.5% - 25% duty rate on items of Chinese origin unless covered by an active exclusion." : "General HTS duty rates apply with preferential tariffs available under active Free Trade Agreements (USMCA, KORUS)."}
- Importers must exercise Reasonable Care under 19 U.S.C. 1508 by maintaining commercial invoices, packing lists, and origin certificates for 5 years.`;

    const citations = [
      "19 U.S.C. 1508 - Recordkeeping Requirements",
      "General Rules of Interpretation (GRI 1 & 6)",
      "19 CFR Part 102 - Rules of Origin",
      ...updates.map((u) => u.title),
    ];

    return NextResponse.json({
      answer: responseAnswer,
      citations,
      regulatoryUpdates: updates,
    });
  } catch (error) {
    console.error("POST /api/advisory/query error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
