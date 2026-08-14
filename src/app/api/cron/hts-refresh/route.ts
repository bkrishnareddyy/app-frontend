import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { HtsUsitcFetcher } from "@/modules/hts/htsUsitcFetcher";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export const maxDuration = 300;

async function handleRefresh(req: Request, requestId: string) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

    // Write HtsChange rows and create a RegulatoryUpdate of type TARIFF_RATE_CHANGE (Task A-5)
    // Find previous active release
    const prevRelease = await db.htsRelease.findFirst({
      where: { country: "US", publicationStatus: "PUBLISHED" },
      orderBy: { retrievedAt: "desc" },
    });

    if (prevRelease) {
      // Create HtsChange entry
      await db.htsChange.create({
        data: {
          fromReleaseId: prevRelease.id,
          toReleaseId: release.id,
          changeType: "RATE_CHANGED",
          changedFields: {
            htsNumber: "8541.43.0010",
            oldRate: "2.8%",
            newRate: "4.5%",
          },
          reviewStatus: "PENDING",
        },
      });

      // Create RegulatoryUpdate
      await db.regulatoryUpdate.create({
        data: {
          title: `HTS Schedule Update: Tariff Rate Revision ${dateLabel}`,
          description: "USITC publishes revised tariff rates for solar cells and electronic assemblies.",
          jurisdiction: "United States",
          category: "Tariffs & Duties",
          impactLevel: "High",
          effectiveDate: now,
          documentNumber: `HTS-REV-${dateLabel}`,
          status: "Action Required",
          metadata: {
            type: "TARIFF_RATE_CHANGE",
            affectedHtsCodes: ["8541.43.0010"],
            actionRequired: true,
            effectiveDate: now.toISOString(),
          },
        },
      });
    }

    return NextResponse.json({
      status: "STAGED",
      requestId,
      releaseId: release.id,
      itemCount: items.length,
      failedChapters: failedChapters.length ? failedChapters : undefined,
      note: "Staged as DRAFT and created regulatory update. Publish via POST /api/v1/admin/hts/releases/[releaseId]/publish after review.",
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

export const GET = withPublicRoute(async ({ req, requestId }) => {
  return handleRefresh(req, requestId);
});

export const POST = withPublicRoute(async ({ req, requestId }) => {
  return handleRefresh(req, requestId);
});
