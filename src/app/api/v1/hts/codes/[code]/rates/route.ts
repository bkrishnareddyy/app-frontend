import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calculateDutyStack, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";

export const GET = withAuthenticatedRoute<{ code: string }>(async ({ req, params }) => {
  const { code } = params;
  const { searchParams } = new URL(req.url);
  const countryOfOrigin = searchParams.get("countryOfOrigin") || "US";
  const manufacturer = searchParams.get("manufacturer") || null;
  const valueParam = searchParams.get("value");
  const value = valueParam ? parseFloat(valueParam) : 1000;

  const publishedRelease = await db.htsRelease.findFirst({
    where: { publicationStatus: "PUBLISHED" },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true },
  });

  const releaseId = publishedRelease?.id || "hts_rel_published_v1";

  const lineItem = {
    htsCode: code,
    totalValue: value,
    countryOfOrigin,
    manufacturer,
  };

  // Real per-code duty-rate lookup (Section 301 applicability/tranche included) --
  // never assume China/List3 for a code that hasn't actually been evaluated.
  const htsCodesMap = await loadHtsCodesMap([lineItem]);
  const htsRateInput = htsCodesMap[code] ?? null;

  const stack = calculateDutyStack(lineItem, htsRateInput, releaseId);

  return NextResponse.json({
    htsCode: code,
    countryOfOrigin,
    manufacturer,
    htsReleaseId: releaseId,
    dutyStack: {
      htsReleaseId: stack.htsReleaseId,
      base: stack.base.toNumber(),
      section301: stack.section301.toNumber(),
      section232: stack.section232.toNumber(),
      antidumping: stack.antidumping.toNumber(),
      countervailing: stack.countervailing.toNumber(),
      other: stack.other.toNumber(),
      total: stack.total.toNumber(),
      mpf: stack.mpf.toNumber(),
      hmf: stack.hmf.toNumber(),
      totalWithFees: stack.totalWithFees.toNumber(),
    },
  });
});
