import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { HtsUsitcFetcher } from "@/modules/hts/htsUsitcFetcher";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export const maxDuration = 300;

async function handleRefresh(requestId: string) {
  let items: any[] = [];
  let chapterResults: any[] = [];
  let fetchRes: any;
  try {
    fetchRes = await HtsUsitcFetcher.fetchFullSchedule();
    items = fetchRes.items;
    chapterResults = fetchRes.chapterResults;
  } catch (e) {
    console.error("USITC fetch failed:", e);
    return NextResponse.json(
      { status: "FAILED", requestId, reason: "USITC fetch failed", error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  // Completeness & expected-count gate
  const completeness = HtsUsitcFetcher.validateCompleteness(fetchRes);
  if (!completeness.valid) {
    console.error(`[hts-refresh] ${completeness.reason}`);
    return NextResponse.json(
      { status: "FAILED", requestId, reason: completeness.reason, chapterResults },
      { status: 502 }
    );
  }

  const failedChapters = chapterResults.filter((c) => !c.ok);

  const now = new Date();
  const editionYear = now.getUTCFullYear();
  const priorCount = await db.htsRelease.count({ where: { country: "US", editionYear } });
  const revisionNumber = priorCount + 1;
  const dateLabel = now.toISOString().slice(0, 10);

  try {
    const currentPublished = await db.htsRelease.findFirst({
      where: { publicationStatus: "PUBLISHED" },
    });

    const release = await HtsIngestionService.stageRelease({
      editionYear,
      revisionNumber,
      releaseName: `USITC HTS ${editionYear} Nightly Refresh ${dateLabel}`,
      sourceUrl: "https://hts.usitc.gov/reststop/exportList",
      sourceFormat: "JSON",
      rawContent: JSON.stringify(items),
      items,
    });

    let diffCount = 0;
    if (currentPublished) {
      diffCount = await HtsIngestionService.generateDiff(currentPublished.id, release.id);
    }

    return NextResponse.json({
      status: "STAGED",
      requestId,
      releaseId: release.id,
      itemCount: items.length,
      diffCount,
      failedChapters: failedChapters.length ? failedChapters : undefined,
      note: "Staged as DRAFT. Authentic release diffing complete against active published release.",
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

