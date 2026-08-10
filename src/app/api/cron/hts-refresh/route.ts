import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { HtsUsitcFetcher } from "@/modules/hts/htsUsitcFetcher";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

// Runs nightly (see vercel.json) to check USITC for a new HTS revision and
// stage it if the content actually changed. Deliberately stages the result
// as a DRAFT only -- it never auto-publishes. Duty rates from this data
// feed real filing calculations (see /api/filing), so a change to
// legally-binding tariff data should go through a human review-and-publish
// step (POST /api/v1/admin/hts/releases/[releaseId]/publish), not become
// live automatically overnight.
export const maxDuration = 300; // chapter-by-chapter fetch is ~99 sequential requests

export const GET = withPublicRoute(async ({ req, requestId }) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { items, chapterResults } = await HtsUsitcFetcher.fetchFullSchedule();
  const failedChapters = chapterResults.filter((c) => !c.ok);

  if (items.length === 0) {
    return NextResponse.json(
      { status: "FAILED", requestId, reason: "USITC fetch returned zero items across all chapters", chapterResults },
      { status: 502 }
    );
  }

  const now = new Date();
  const editionYear = now.getUTCFullYear();
  // Not USITC's own official revision number (that's not exposed by this
  // API) -- an internal, monotonically increasing counter for our own
  // staged releases within this edition year.
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

    return NextResponse.json({
      status: "STAGED",
      requestId,
      releaseId: release.id,
      itemCount: items.length,
      failedChapters: failedChapters.length ? failedChapters : undefined,
      note: "Staged as DRAFT. Publish via POST /api/v1/admin/hts/releases/[releaseId]/publish after review.",
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
});
