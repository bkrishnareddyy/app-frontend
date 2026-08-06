import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const result = searchParams.get("result");

    const where: any = { accountId: ctx.accountId };
    if (result) {
      where.overallResult = { equals: result, mode: "insensitive" };
    }

    const auditRecords = await db.complianceAuditRecord.findMany({
      where,
      include: {
        filing: {
          include: { shipment: true },
        },
      },
      orderBy: { runAt: "desc" },
    });

    return NextResponse.json({ auditRecords });
  } catch (error) {
    console.error("GET /api/compliance/audits error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
