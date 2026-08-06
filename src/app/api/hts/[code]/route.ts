import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code } = await context.params;
    const cleanCode = decodeURIComponent(code);

    const htsItem = await db.hTSCode.findFirst({
      where: {
        OR: [
          { htsCode10: cleanCode },
          { id: cleanCode },
        ],
      },
    });

    if (!htsItem) {
      return NextResponse.json({ error: "HTS Code not found" }, { status: 404 });
    }

    return NextResponse.json({ htsCode: htsItem });
  } catch (error) {
    console.error("GET /api/hts/[code] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
