import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { CrossIngestionService, RULING_TYPES } from "@/modules/regulatory/crossIngestionService";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: "Platform Admin privileges required for CROSS ruling ingestion" });
  }

  try {
    const body = await req.json();
    const { rulingNumber, issuedAt, title, office, rulingType, sourceUrl, htsCodes, fragments } = body;

    if (!rulingNumber || !title || !htsCodes || !fragments) {
      return NextResponse.json({ error: "rulingNumber, title, htsCodes, and fragments are required" }, { status: 400 });
    }

    // Was `issuedAt || new Date()`, which stamped today's date on a ruling that
    // CBP issued years earlier and that the search orders by issuedAt.
    const issued = new Date(issuedAt);
    if (!issuedAt || Number.isNaN(issued.getTime())) {
      return NextResponse.json({ error: "issuedAt is required and must be a valid date" }, { status: 400 });
    }

    if (!RULING_TYPES.includes(rulingType)) {
      return NextResponse.json(
        { error: `rulingType is required and must be one of: ${RULING_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const ruling = await CrossIngestionService.ingestRuling({
      rulingNumber,
      issuedAt: issued,
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
  } catch (error: unknown) {
    return handleApiError(error);
  }

}, { permission: "settings.manage", write: true });
