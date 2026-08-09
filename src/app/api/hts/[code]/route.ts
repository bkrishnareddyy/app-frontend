import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ code: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ code: string }>(async ({ requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const cleanCode = decodeURIComponent(paramsVal.data.code);

  const htsItem = await db.hTSCode.findFirst({
    where: {
      OR: [
        { htsCode10: cleanCode },
        { id: cleanCode },
      ],
    },
  });

  if (!htsItem) {
    return NextResponse.json({ error: "HTS Code not found" }, { status: 404 });
  }

  return NextResponse.json({ htsCode: htsItem });
});
