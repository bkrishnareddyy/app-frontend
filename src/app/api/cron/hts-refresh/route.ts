import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { HtsUsitcFetcher } from "@/modules/hts/htsUsitcFetcher";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export const maxDuration = 300;

async function handleRefresh(requestId: string) {
  let items: any[] = [];
  let chapterResults: any[] = [];
  try {
    const fetchRes = await HtsUsitcFetcher.fetchFullSchedule();
    items = fetchRes.items;
    chapterResults = fetchRes.chapterResults;
  } catch (e) {
    console.error("USITC fetch failed:", e);
    return NextResponse.json(
      { status: "FAILED", requestId, reason: "USITC fetch failed", error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const failedChapters = chapterResults.filter((c) => !c.ok);

  if (items.length === 0) {
    return NextResponse.json(
      { status: "FAILED", requestId, reason: "USITC fetch returned zero items across all chapters", chapterResults },
      { status: 502 }
    );
  }

  const now = new Date();
  const editionYear = now.getUTCFullYear();
  const priorCount = await db.htsRelease.count({ where: { country: "US", editionYear } });
  const revisionNumber = priorCount + 1;
  const dateLabel = now.toISOString().slice(0, 10);

  try {
    const release = await HtsIngestionService.stageRelease({
      editionYear,
      revisionNumber,
      releaseName: `USITC HTS ${editionYear} Nightly Refresh ${dateLabel}`,
      sourceUrl: "https://hts.usitc.gov/reststop/exportList",
      sourceFormat: "JSON",
      rawContent: JSON.stringify(items),
      items,
    });

    // Real release-to-release diffing (populating HtsChange from an actual
    // field comparison between the previous PUBLISHED release and this DRAFT)
    // is not implemented yet. Previously this block wrote a hardcoded,
    // fabricated HtsChange + RegulatoryUpdate on every refresh regardless of
    // what USITC actually published -- that was worse than reporting nothing.

    return NextResponse.json({
      status: "STAGED",
      requestId,
      releaseId: release.id,
      itemCount: items.length,
      failedChapters: failedChapters.length ? failedChapters : undefined,
      note: "Staged as DRAFT. Publish via POST /api/v1/admin/hts/releases/[releaseId]/publish after review. Change detection against the prior release is not yet implemented.",
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Duplicate ingestion rejected")) {
      return NextResponse.json({
        status: "NO_CHANGE",
        requestId,
        itemCount: items.length,
        failedChapters: failedChapters.length ? failedChapters : undefined,
        note: "Fetched content is identical to the currently published release -- nothing staged.",
      });
    }
    return NextResponse.json(
      { status: "FAILED", requestId, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export const POST = withCronRoute(async ({ requestId }) => {
  return handleRefresh(requestId);
});
