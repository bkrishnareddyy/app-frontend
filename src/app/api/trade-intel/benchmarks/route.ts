import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

async function ensureBenchmarksSeeded() {
  const count = await db.tradeBenchmark.count();
  if (count === 0) {
    await db.tradeBenchmark.createMany({
      data: [
        {
          htsCode10: "8481.80.5090",
          industryAvgDuty: 2.8,
          avgDeclaredPrice: 135.5,
          topOriginCountry: "Japan",
          totalUSVolumeVal: 485000000.0,
        },
        {
          htsCode10: "8537.10.2030",
          industryAvgDuty: 2.7,
          avgDeclaredPrice: 92.0,
          topOriginCountry: "China",
          totalUSVolumeVal: 1250000000.0,
        },
      ],
      skipDuplicates: true,
    });
  }
}

export const GET = withAuthenticatedRoute(async ({ req }) => {
  await ensureBenchmarksSeeded();

  const { searchParams } = new URL(req.url);
  const htsCode = searchParams.get("htsCode");

  if (htsCode) {
    const benchmark = await db.tradeBenchmark.findFirst({
      where: { htsCode10: { contains: htsCode } },
    });
    return NextResponse.json({ benchmark });
  }

  const benchmarks = await db.tradeBenchmark.findMany({
    orderBy: { totalUSVolumeVal: "desc" },
  });

  return NextResponse.json({ benchmarks });
});
