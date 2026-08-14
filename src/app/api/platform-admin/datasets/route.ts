import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { getAllDatasetsWithStatus } from "@/lib/data/datasetRegistry";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const datasets = await getAllDatasetsWithStatus();

  const summary = {
    total: datasets.length,
    liveCount: datasets.filter((d) => d.readinessStatus === "LIVE").length,
    notYetImplementedCount: datasets.filter((d) => d.readinessStatus === "NOT_YET_IMPLEMENTED").length,
    publicApiCount: datasets.filter((d) => d.category === "Public API").length,
    structuredDocumentCount: datasets.filter((d) => d.category === "Structured Document").length,
  };

  return NextResponse.json({
    datasets,
    summary,
    timestamp: new Date().toISOString(),
  });
});
