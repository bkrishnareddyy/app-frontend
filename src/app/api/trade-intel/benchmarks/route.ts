import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

// ensureBenchmarksSeeded() used to run here and write invented industry averages
// and US import volumes into the shared TradeBenchmark table on the first read.
// The table is global, so one tenant's GET published those figures to every tenant.

export const GET = withAuthenticatedRoute(async ({ req }) => {
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
