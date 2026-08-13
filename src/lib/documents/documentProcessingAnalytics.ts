/**
 * Platform-admin reporting over document processing runs.
 *
 * Nothing here is a new source of truth. `DocumentParseVersion` (see
 * `modules/documents/processing/processingRuns.ts`) is the only place a
 * parse/extraction attempt's status, confidence, duration and error are ever
 * recorded — this module only reads and reduces that table. No confidence
 * figure is estimated or backfilled: rows with a null `confidence` (queued,
 * in-flight, or a run whose parser reported none) are excluded from the
 * distribution rather than treated as zero.
 */

import { db } from "@/lib/db";

export interface DocumentRunStatusCounts {
  succeeded: number;
  failed: number;
  needsReview: number;
  processing: number;
  total: number;
}

export interface DocumentConfidenceStats {
  sampleSize: number;
  median: number | null;
  p90: number | null;
  p99: number | null;
}

export interface DocumentLatencyStats {
  sampleSize: number;
  medianMs: number | null;
  p90Ms: number | null;
}

export interface DocumentErrorStat {
  errorCode: string;
  count: number;
  retryable: number;
}

export interface DocumentProcessingAnalytics {
  rangeDays: number;
  sinceIso: string;
  statusCounts: DocumentRunStatusCounts;
  confidence: DocumentConfidenceStats;
  latency: DocumentLatencyStats;
  errors: DocumentErrorStat[];
}

const PROCESSING_STATUSES = ["QUEUED", "SUBMITTED", "POLLING"] as const;

/** Nearest-rank percentile over an already-sorted ascending array. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** Everything the platform-admin "Agents" analytics tab renders for document processing, pre-aggregated and serializable. */
export async function getDocumentProcessingAnalytics(rangeDays = 30): Promise<DocumentProcessingAnalytics> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (rangeDays - 1));

  const [statusRows, confidenceRows, latencyRows, errorRows] = await Promise.all([
    db.documentParseVersion.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.documentParseVersion.findMany({
      where: { createdAt: { gte: since }, confidence: { not: null } },
      select: { confidence: true },
    }),
    db.documentParseVersion.findMany({
      where: { createdAt: { gte: since }, durationMs: { not: null } },
      select: { durationMs: true },
    }),
    db.documentParseVersion.groupBy({
      by: ["errorCode", "retryable"],
      where: { createdAt: { gte: since }, status: "FAILED", errorCode: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const statusCountByKey = new Map(statusRows.map((r) => [r.status, r._count._all]));
  const succeeded = statusCountByKey.get("SUCCEEDED") ?? 0;
  const failed = statusCountByKey.get("FAILED") ?? 0;
  const needsReview = statusCountByKey.get("NEEDS_REVIEW") ?? 0;
  const processing = PROCESSING_STATUSES.reduce((sum, s) => sum + (statusCountByKey.get(s) ?? 0), 0);
  const total = statusRows.reduce((sum, r) => sum + r._count._all, 0);

  const confidenceValues = confidenceRows
    .map((r) => r.confidence)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const latencyValues = latencyRows
    .map((r) => r.durationMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const errorMap = new Map<string, { count: number; retryable: number }>();
  for (const row of errorRows) {
    const code = row.errorCode ?? "UNKNOWN";
    const entry = errorMap.get(code) ?? { count: 0, retryable: 0 };
    entry.count += row._count._all;
    if (row.retryable) entry.retryable += row._count._all;
    errorMap.set(code, entry);
  }
  const errors: DocumentErrorStat[] = Array.from(errorMap.entries())
    .map(([errorCode, s]) => ({ errorCode, count: s.count, retryable: s.retryable }))
    .sort((a, b) => b.count - a.count);

  return {
    rangeDays,
    sinceIso: since.toISOString(),
    statusCounts: { succeeded, failed, needsReview, processing, total },
    confidence: {
      sampleSize: confidenceValues.length,
      median: percentile(confidenceValues, 50),
      p90: percentile(confidenceValues, 90),
      p99: percentile(confidenceValues, 99),
    },
    latency: {
      sampleSize: latencyValues.length,
      medianMs: percentile(latencyValues, 50),
      p90Ms: percentile(latencyValues, 90),
    },
    errors,
  };
}
