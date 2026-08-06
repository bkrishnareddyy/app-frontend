import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Seed default broker metrics if empty
    const count = await db.brokerMetrics.count({ where: { accountId: ctx.accountId } });
    if (count === 0) {
      await db.brokerMetrics.createMany({
        data: [
          {
            accountId: ctx.accountId,
            brokerName: "Qubere Automated Compliance Services",
            entriesProcessed: 284,
            accuracyPct: 99.2,
            overrideRatePct: 1.4,
            correctionRatePct: 0.3,
            avgReviewTimeMin: 12,
            rejectedCount: 0,
          },
          {
            accountId: ctx.accountId,
            brokerName: "Pacific Customs Brokerage Inc",
            entriesProcessed: 86,
            accuracyPct: 96.5,
            overrideRatePct: 4.8,
            correctionRatePct: 1.8,
            avgReviewTimeMin: 45,
            rejectedCount: 2,
          },
        ],
      });
    }

    const brokerMetrics = await db.brokerMetrics.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { accuracyPct: "desc" },
    });

    return NextResponse.json({ brokerMetrics });
  } catch (error) {
    console.error("GET /api/risk/brokers error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
