import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export async function POST(req: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;
  if (!ctx?.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required to publish HTS release" }, { status: 403 });
  }

  try {
    const { releaseId } = await params;
    const published = await HtsIngestionService.publishRelease(releaseId);
    return NextResponse.json({ release: published, status: "PUBLISHED" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to publish HTS release" }, { status: 400 });
  }
}
