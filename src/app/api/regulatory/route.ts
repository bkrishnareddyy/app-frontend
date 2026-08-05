import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const updates = await db.regulatoryUpdate.findMany({
      orderBy: { effectiveDate: "desc" },
    });

    return NextResponse.json({ updates });
  } catch (error) {
    console.error("GET /api/regulatory error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
