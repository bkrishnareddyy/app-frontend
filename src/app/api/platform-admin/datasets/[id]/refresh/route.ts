import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { refreshDataset, getDatasetById } from "@/lib/data/datasetRegistry";

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

  const existing = getDatasetById(id);
  if (!existing) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Dataset "${id}" not found`, requestId } },
      { status: 404 }
    );
  }

  try {
    const result = await refreshDataset(id);
    return NextResponse.json({
      status: result.success ? "SUCCESS" : "FAILED",
      dataset: result.dataset,
      message: result.message,
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
