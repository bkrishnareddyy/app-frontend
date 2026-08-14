import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { getDatasetById, triggerDatasetRefresh } from "@/lib/data/datasetRegistry";

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, params, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dataset ID is required", requestId } },
      { status: 400 }
    );
  }

  const def = getDatasetById(id);
  if (!def) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Dataset "${id}" not found`, requestId } },
      { status: 404 }
    );
  }

  // Refuse with a clear 422 for un-wired datasets — never fake success
  if (def.readinessStatus === "NOT_YET_IMPLEMENTED") {
    return NextResponse.json(
      {
        status: "NOT_YET_IMPLEMENTED",
        message: `Dataset "${def.name}" ingestion pipeline is not yet implemented. No data was fetched or written. This dataset is on the engineering roadmap.`,
        requestId,
      },
      { status: 422 }
    );
  }

  try {
    const result = await triggerDatasetRefresh(id);
    return NextResponse.json({
      status: result.success ? "SUCCESS" : "FAILED",
      message: result.message,
      logId: result.logId,
      requestId,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "FAILED",
        error: err.message || "Failed to trigger dataset refresh",
        requestId,
      },
      { status: 500 }
    );
  }
});
