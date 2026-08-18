import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { MemoryRepository, HybridMemoryRetriever, MemoryExtractorWorker } from "@/modules/memory";
import type { AgentTask } from "@/modules/memory";
import type { AccountMemoryType } from "@prisma/client";

export const GET = withAuthenticatedRoute(async ({ req }) => {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId") || undefined;
    const query = searchParams.get("q") || undefined;
    const type = (searchParams.get("type") as AccountMemoryType) || undefined;
    const task = (searchParams.get("task") as AgentTask) || "HTS_CLASSIFICATION";
    const mode = searchParams.get("mode") || "list"; // "list" | "search" | "analytics"

    if (mode === "analytics") {
      const analytics = await MemoryRepository.getMemoryAnalytics(accountId);
      return NextResponse.json({ analytics });
    }

    if (mode === "search" && accountId && query) {
      const searchResults = await HybridMemoryRetriever.search({
        accountId,
        task,
        query,
        limit: 15,
      });
      return NextResponse.json({ searchResults });
    }

    // Default: list memories
    const memories = accountId
      ? await MemoryRepository.findMemoriesByAccount(accountId, {
          type,
          includeSuperseded: true,
          limit: 100,
        })
      : [];

    const analytics = await MemoryRepository.getMemoryAnalytics(accountId);

    return NextResponse.json({
      memories,
      analytics,
    });
  } catch (err) {
    console.error("[api/platform-admin/memory GET] Error:", err);
    return NextResponse.json({ error: "Failed to fetch account memory data" }, { status: 500 });
  }
}, { permission: "platform.admin", write: false });

export const POST = withAuthenticatedRoute(async ({ req }) => {
  try {
    const body = await req.json();
    const { action, accountId, sampleData } = body;

    if (action === "extract_sample") {
      if (!accountId) {
        return NextResponse.json({ error: "accountId is required for extraction" }, { status: 400 });
      }

      const memory = await MemoryExtractorWorker.processEvent({
        accountId,
        sourceType: "HUMAN_DECISION",
        sourceId: sampleData?.decisionId || `admin-trigger-${Date.now()}`,
        task: sampleData?.task || "HTS_CLASSIFICATION",
        decisionSummary: sampleData?.decisionSummary || "Admin manual test decision extraction",
        proposedHtsCode: sampleData?.proposedHtsCode || "8471.49.0000",
        originalHtsCode: sampleData?.originalHtsCode || "8471.30.0000",
        productDescription: sampleData?.productDescription || "High-performance processing unit",
        partNumber: sampleData?.partNumber || "SKU-99201",
        humanNotes: sampleData?.humanNotes || "Confirmed configuration requires broad processing heading.",
        actionType: "APPROVE_OVERRIDE",
      });

      return NextResponse.json({
        success: true,
        message: "Memory extracted successfully",
        memory,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[api/platform-admin/memory POST] Error:", err);
    return NextResponse.json({ error: "Failed to execute memory admin action" }, { status: 500 });
  }
}, { permission: "platform.admin", write: true });
