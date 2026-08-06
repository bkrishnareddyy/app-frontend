import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const opportunities = await db.refundOpportunity.findMany({
      where: { accountId: ctx.accountId },
      include: {
        filing: {
          include: { shipment: true },
        },
      },
      orderBy: { identifiedAt: "desc" },
    });

    return NextResponse.json({ opportunities });
  } catch (error) {
    console.error("GET /api/refunds/opportunities error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
