import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { HtsIngestionService } from "@/modules/hts/htsIngestionService";
import { z } from "zod";

const paramsSchema = z.object({ releaseId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ releaseId: string }>(async ({ ctx, requestId, params }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required to rollback HTS release" }, { status: 403 });
  }

  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  try {
    const result = await HtsIngestionService.rollbackRelease(paramsVal.data.releaseId);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to rollback HTS release" }, { status: 400 });
  }
});
