import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { CrossIngestionService } from "@/modules/regulatory/crossIngestionService";

export async function POST(req: Request) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;
  if (!ctx?.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required for CROSS ruling ingestion" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { rulingNumber, issuedAt, title, office, rulingType, sourceUrl, htsCodes, fragments } = body;

    if (!rulingNumber || !title || !htsCodes || !fragments) {
      return NextResponse.json({ error: "rulingNumber, title, htsCodes, and fragments are required" }, { status: 400 });
    }

    const ruling = await CrossIngestionService.ingestRuling({
      rulingNumber,
      issuedAt: issuedAt || new Date(),
      title,
      office,
      rulingType,
      sourceUrl,
      htsCodes,
      fragments,
      accountId: ctx.accountId,
      userId: ctx.userId,
    });

    return NextResponse.json({ ruling, status: "INGESTED" }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to ingest CROSS ruling" }, { status: 400 });
  }
}
