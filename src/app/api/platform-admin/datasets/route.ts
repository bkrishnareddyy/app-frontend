import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { getAllDatasets } from "@/lib/data/datasetRegistry";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const datasets = getAllDatasets();
  const summary = {
    total: datasets.length,
    publicApiCount: datasets.filter((d) => d.category === "Public API").length,
    structuredDocumentCount: datasets.filter((d) => d.category === "Structured Document").length,
    healthyCount: datasets.filter((d) => d.status === "success" || d.status === "idle").length,
  };

  return NextResponse.json({
    datasets,
    summary,
    timestamp: new Date().toISOString(),
  });
});
