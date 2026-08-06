import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";

// Seed data helper if empty
async function ensureHtsSeeded() {
  const count = await db.hTSCode.count();
  if (count === 0) {
    await db.hTSCode.createMany({
      data: [
        {
          htsCode10: "8481.80.5090",
          description: "Taps, cocks, valves and similar appliances for pipes, boiler shells, tanks, vats or the like: Valves for oleohydraulic or pneumatic transmissions",
          chapterNumber: "84",
          headingNumber: "8481",
          subheadingNumber: "8481.80",
          unitOfQuantity: "PCS",
          generalDutyRate: "2.8%",
          specialRatePrograms: { USMCA: "Free", KORUS: "Free", AU: "Free" },
          column2DutyRate: "35%",
          section301Applicable: true,
          section301AdditionalRate: 7.5,
          sourceRevision: "HTSUS 2026 Rev 1",
        },
        {
          htsCode10: "8537.10.2030",
          description: "Boards, panels, consoles, desks, cabinets and other bases, equipped with two or more apparatus of heading 8535 or 8536, for electric control or the distribution of electricity: For a voltage not exceeding 1,000 V",
          chapterNumber: "85",
          headingNumber: "8537",
          subheadingNumber: "8537.10",
          unitOfQuantity: "PCS",
          generalDutyRate: "2.7%",
          specialRatePrograms: { USMCA: "Free", KORUS: "Free" },
          column2DutyRate: "35%",
          section301Applicable: true,
          section301AdditionalRate: 25.0,
          sourceRevision: "HTSUS 2026 Rev 1",
        },
        {
          htsCode10: "7318.15.2065",
          description: "Screws, bolts, nuts, coach screws, screw hooks, rivets, cotters, cotter pins, washers and similar articles, of iron or steel: Other screws and bolts",
          chapterNumber: "73",
          headingNumber: "7318",
          subheadingNumber: "7318.15",
          unitOfQuantity: "KG",
          generalDutyRate: "6.2%",
          specialRatePrograms: { USMCA: "Free" },
          column2DutyRate: "45%",
          section232Applicable: true,
          section232AdditionalRate: 25.0,
          sourceRevision: "HTSUS 2026 Rev 1",
        },
      ],
      skipDuplicates: true,
    });
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureHtsSeeded();

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || searchParams.get("q") || "";
    const chapter = searchParams.get("chapter");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (chapter) {
      where.chapterNumber = chapter;
    }

    if (search.trim()) {
      const q = search.trim();
      where.OR = [
        { htsCode10: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { headingNumber: { contains: q, mode: "insensitive" } },
      ];
    }

    const [totalCount, htsCodes] = await Promise.all([
      db.hTSCode.count({ where }),
      db.hTSCode.findMany({
        where,
        orderBy: { htsCode10: "asc" },
        skip,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      htsCodes,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    });
  } catch (error) {
    console.error("GET /api/hts error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
