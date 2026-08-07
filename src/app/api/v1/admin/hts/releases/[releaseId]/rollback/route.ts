import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";

export async function POST(req: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;
  if (!ctx?.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required to rollback HTS release" }, { status: 403 });
  }

  try {
    const { releaseId } = await params;
    const result = await HtsIngestionService.rollbackRelease(releaseId);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to rollback HTS release" }, { status: 400 });
  }
}
