import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";
import { z } from "zod";

const paramsSchema = z.object({ releaseId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ releaseId: string }>(async ({ ctx, requestId, params }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required to publish HTS release" }, { status: 403 });
  }

  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  try {
    const published = await HtsIngestionService.publishRelease(paramsVal.data.releaseId);
    return NextResponse.json({ release: published, status: "PUBLISHED" });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
