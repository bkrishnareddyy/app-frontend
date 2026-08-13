import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required for HTS ingestion" });
  }

  try {
    const body = await req.json();
    const { editionYear, revisionNumber, releaseName, sourceUrl, sourceFormat, rawContent, items } = body;

    if (!releaseName || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: "Missing required releaseName or items array" }, { status: 400 });
    }

    const release = await HtsIngestionService.stageRelease({
      editionYear: editionYear || new Date().getFullYear(),
      revisionNumber: revisionNumber || 1,
      releaseName,
      sourceUrl: sourceUrl || "https://hts.usitc.gov/export",
      sourceFormat: sourceFormat || "JSON",
      rawContent: rawContent || JSON.stringify(items),
      items,
});

    return NextResponse.json({ release, status: "STAGED_DRAFT" });
  } catch (error: unknown) {
    return handleApiError(error);
  }

}, { permission: "settings.manage", write: true });
